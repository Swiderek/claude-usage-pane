import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { Limit, RefreshStatus, UsageReport } from '../types'

const PANE = 'usage-pane'
const TITLE = 'Usage'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const REFRESH_MS = 5 * 60 * 1000
// Sessions open side by side share one count through $.store for this long.
const CACHE_MS = 4 * 60 * 1000
// Each way Python 3 may start, tried in turn; the first that runs is kept. On
// Windows `python3` is often the Microsoft Store's stand-in, which runs only to
// say Python is missing: that counts as not found. The engine's PATH may also
// lack Homebrew's, hence the full paths.
const PYTHONS: readonly (readonly string[])[] = [
  ['python3'],
  ['py', '-3'],
  ['python'],
  ['/opt/homebrew/bin/python3'],
  ['/usr/local/bin/python3'],
  ['/usr/bin/python3'],
]
const NO_PYTHON =
  'Python 3 was not found. Install it from python.org (on Windows: winget install Python.Python.3.13), then press Refresh.'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Change a tag when that value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const report = atom({ plugin: 'usage-pane', key: 'report' } as const, null, {
  shape: 'report-1',
})
const limits = atom({ plugin: 'usage-pane', key: 'limits' } as const, [], {
  shape: 'limits-1',
})
const status = atom(
  { plugin: 'usage-pane', key: 'status' } as const,
  { isLoading: false },
  { shape: 'status-1' },
)

const LIMIT_LABELS: Record<string, string> = {
  seven_day: 'Week',
  five_hour: '5 hours',
  spend_limit: 'Budget',
}

// Your own conversation and the agents it ran, each with its color and glyph,
// so the split reads without color too.
const MINE: Color = 'suggestion'
const AGENTS: Color = 'claude'

/**
 * Whether the weekly limit is being used faster than the week is passing.
 *
 * @returns the Pace row's words and color, or null to leave the row out
 */
function paceVerdict(
  percentUsed: number,
  resetsAt: string,
  now: number,
): { label: string; color: Color } | null {
  if (percentUsed >= 100) return { label: 'limit reached', color: 'error' }
  const left = Date.parse(resetsAt) - now
  const elapsed = Math.min(WEEK_MS, Math.max(0, WEEK_MS - left))
  // Too little of the week has passed for a ratio to mean anything.
  if (elapsed < 12 * 60 * 60 * 1000) return null

  const ratio = percentUsed / 100 / (elapsed / WEEK_MS)
  const gone = `${Math.round((elapsed / WEEK_MS) * 100)}% of week gone`
  if (ratio <= 1.1) return { label: `on track (${gone})`, color: 'success' }

  // At this rate the rest of the limit lasts this long; past the reset it is no risk.
  const lasts = ((100 - percentUsed) / percentUsed) * elapsed
  const runsOut = lasts < left ? `, runs out in ${span(lasts)}` : ''
  if (ratio <= 1.4) return { label: `fast (${gone}${runsOut})`, color: 'warning' }

  return { label: `too fast (${gone}${runsOut})`, color: 'error' }
}

let inFlight: Promise<void> | null = null
let python: readonly string[] | null = null
let isWatching = false
let hasOpened = false

/** Windows' "Python was not found" stand-in exits 9009 and says so. */
function isMissing(run: { exitCode: number; stderr: string }): boolean {
  return run.exitCode === 9009 || /Python was not found|Microsoft Store/i.test(run.stderr)
}

async function runPython(
  $: EngineInterface,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const candidates = python ? [python, ...PYTHONS.filter(c => c !== python)] : PYTHONS
  for (const candidate of candidates) {
    try {
      // -I and the plugin's own folder: nothing in the session's project
      // (a json.py, PYTHONPATH) is imported in place of the standard library.
      const run = await $.process.run([...candidate, '-I', ...args], {
        cwd: $.plugin.root,
        timeoutMs: 120_000,
      })
      if (isMissing(run)) continue
      python = candidate

      return run
    } catch {
      // Not on this machine: try the next.
    }
  }
  python = null
  throw new Error(NO_PYTHON)
}

/** Someone can see the session: open the pane once, unless asked not to, and keep counting. */
function watch($: EngineInterface, panel: unknown): void {
  if (panel !== 'command' && !hasOpened) {
    hasOpened = true
    void $.ui.open({ id: PANE, title: TITLE })
  }
  if (isWatching) return
  isWatching = true
  void refresh($)
  $.clock.every(REFRESH_MS, () => void refresh($))
}

function toLimits(windows: readonly Limit[]): Limit[] {
  return windows.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))
}

/** A report another session counted a moment ago for the same week, if any. */
async function cachedReport(
  $: EngineInterface,
  since: string | undefined,
  now: number,
): Promise<UsageReport | null> {
  try {
    const cached = (await $.store.get('report')) as UsageReport | undefined
    if (!cached || now - cached.generatedAt > CACHE_MS) return null
    const isSameWeek = since
      ? !cached.isRolling && Date.parse(cached.since) === Date.parse(since)
      : cached.isRolling

    return isSameWeek ? cached : null
  } catch {
    return null
  }
}

function refresh($: EngineInterface, { force = false } = {}): Promise<void> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      await update($, status, s => ({ ...s, isLoading: true }))
      const live = toLimits((await $.session.usage()).rateLimits)
      if (live.length > 0) await update($, limits, () => live)
      const known = live.length > 0 ? live : await read($, limits)
      const week = known.find(l => l.kind === 'seven_day')
      const since = week?.resetsAt
        ? new Date(Date.parse(week.resetsAt) - WEEK_MS).toISOString()
        : undefined

      let fresh = force ? null : await cachedReport($, since, await $.clock.now())
      if (!fresh) {
        const args = [`${$.plugin.root}/scripts/usage.py`, ...(since ? [since] : [])]
        const run = await runPython($, args)
        if (run.exitCode !== 0) {
          const why = run.stderr.trim().split('\n').pop()
          throw new Error(why || `the script exited with code ${run.exitCode}`)
        }
        fresh = JSON.parse(run.stdout) as UsageReport
        await $.store.set('report', fresh).catch(() => undefined)
      }
      const counted = fresh
      await update($, report, () => counted)
      await update($, status, (): RefreshStatus => ({ isLoading: false }))
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      // The session may have ended or reloaded mid-count: nothing left to tell.
      await update($, status, (): RefreshStatus => ({ isLoading: false, error })).catch(() => undefined)
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

function millions(n: number): string {
  return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`
}

function share(part: number, total: number): string {
  return `${total > 0 ? Math.round((part / total) * 100) : 0}%`.padStart(4)
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function bar(fraction: number, width: number): string {
  const full = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return '█'.repeat(full) + '░'.repeat(width - full)
}

/** A bar of `scale` cells split into your part, the agents' part and the rest. */
function stack(eff: number, subEff: number, scale: number, width: number) {
  const cells = (n: number) => Math.max(0, Math.round((n / Math.max(scale, 1)) * width))
  const agents = Math.min(width, cells(subEff))
  const mine = Math.max(0, Math.min(width - agents, cells(eff) - agents))

  return {
    mine: '█'.repeat(mine),
    agents: '▓'.repeat(agents),
    rest: '░'.repeat(width - agents - mine),
  }
}

function span(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes % 60}m`
}

function until(resetsAt: string | undefined, now: number): string {
  return resetsAt ? `resets in ${span(Date.parse(resetsAt) - now)}` : ''
}

function ago(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000)
  return minutes < 1 ? 'just now' : `${minutes} min ago`
}

function limitColor(percentUsed: number): Color {
  if (percentUsed >= 90) return 'error'
  if (percentUsed >= 75) return 'warning'

  return 'success'
}

function monthDay(iso: string): string {
  const d = new Date(Date.parse(iso))

  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-pane',
      description: 'Show the token usage pane: plan limits, projects, sessions, agents',
    })
    // The terminal is there from the start. The desktop app, a phone or an IDE
    // attaches a moment later, or had already before a reload. A `-p` run that
    // nobody attaches to never counts.
    if (e.isInteractive || (await $.session.surfaces()).length > 0) watch($, options.panel)

    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    watch($, options.panel)

    return next(e)
  })

  on('command.run', { command: 'usage-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    void refresh($)

    return { text: 'Usage pane opened.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.length > 0) {
      await update($, limits, () => toLimits(e.rateLimits))
      // The first report counted a rolling 7 days; the plan's week is now known.
      const current = await read($, report)
      if (current?.isRolling && e.rateLimits.some(l => l.kind === 'seven_day')) {
        void refresh($)
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const rep = await read($, report)
    const windows = await read($, limits)
    const st = await read($, status)
    const now = await $.clock.now()
    const cols = Math.max(24, e.props.bodyColumns)
    const barWidth = Math.max(6, Math.min(16, Math.floor(cols * 0.25)))
    const week = windows.find(l => l.kind === 'seven_day')
    const pace = week?.resetsAt ? paceVerdict(week.percentUsed, week.resetsAt, now) : null
    const top = rep?.projects[0]?.eff ?? 1
    const topSession = rep?.topSessions[0]?.eff ?? 1
    // The week's split, kept well inside the pane: a surface that draws text in
    // a proportional face fits fewer block glyphs than it has columns. Bars stay
    // in that face, not `mono`: a monospaced face can draw block glyphs taller
    // than the row (Windows), over the line above.
    const whole = rep
      ? stack(rep.total, rep.subTotal, rep.total, Math.max(10, Math.min(32, Math.floor(cols * 0.6))))
      : { mine: '', agents: '', rest: '' }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text weight="semibold">Plan limits</Text>
          {windows.length === 0 && <Text dimColor>Shown after the model's first reply.</Text>}
          {windows.map(w => (
            <Box flexDirection="row" gap={1}>
              <Text tabular>
                {(LIMIT_LABELS[w.kind] ?? w.kind).padEnd(7)} {`${Math.round(w.percentUsed)}%`.padStart(4)}
              </Text>
              <Text color={limitColor(w.percentUsed)}>
                {bar(w.percentUsed / 100, barWidth)}
              </Text>
              <Text dimColor wrap="truncate-end">
                {until(w.resetsAt, now)}
              </Text>
            </Box>
          ))}
          {pace && (
            <Text>
              Pace: <Text color={pace.color}>{pace.label}</Text>
            </Text>
          )}
        </Box>

        {rep === null ? (
          <Text dimColor>{st.isLoading ? 'Counting usage from local transcripts…' : 'No data yet.'}</Text>
        ) : (
          <Box flexDirection="column" gap={1}>
            <Text dimColor wrap="truncate-end">
              {rep.isRolling ? 'Last 7 days' : `Since ${monthDay(rep.since)}`} · {millions(rep.total)} effective
              tokens · {count(rep.sessions, 'session')}
            </Text>

            <Box flexDirection="column">
              <Text weight="semibold">Who used it</Text>
              <Text wrap="truncate-end">
                <Text color={MINE}>{whole.mine}</Text>
                <Text color={AGENTS}>{whole.agents}</Text>
              </Text>
              <Text wrap="truncate-end">
                <Text color={MINE}>█</Text> you {share(rep.total - rep.subTotal, rep.total).trim()} ·{' '}
                <Text color={AGENTS}>▓</Text> agents {share(rep.subTotal, rep.total).trim()}
              </Text>
              <Text dimColor wrap="truncate-end">
                {count(rep.agents, 'agent')} in {rep.sessionsWithAgents} of {count(rep.sessions, 'session')}
              </Text>
            </Box>

            <Box flexDirection="column">
              <Text weight="semibold">Projects</Text>
              {rep.projects.map(p => {
                const s = stack(p.eff, p.subEff, top, barWidth)

                return (
                  <Box flexDirection="row" gap={1}>
                    <Text tabular>{share(p.eff, rep.total)}</Text>
                    <Text>
                      <Text color={MINE}>{s.mine}</Text>
                      <Text color={AGENTS}>{s.agents}</Text>
                      <Text dimColor>{s.rest}</Text>
                    </Text>
                    <Text wrap="truncate-end">{p.label}</Text>
                  </Box>
                )
              })}
            </Box>

            <Box flexDirection="column">
              <Text weight="semibold">Sessions</Text>
              {rep.topSessions.map(s => {
                const b = stack(s.eff, s.subEff, topSession, barWidth)

                return (
                  <Box flexDirection="column">
                    <Box flexDirection="row" gap={1}>
                      <Text tabular>{share(s.eff, rep.total)}</Text>
                      <Text>
                        <Text color={MINE}>{b.mine}</Text>
                        <Text color={AGENTS}>{b.agents}</Text>
                        <Text dimColor>{b.rest}</Text>
                      </Text>
                      <Text wrap="truncate-end">{s.title}</Text>
                    </Box>
                    <Text dimColor wrap="truncate-end">
                      {'     '}
                      {s.project}
                      {s.agents > 0
                        ? ` · ${count(s.agents, 'agent')}, ${share(s.subEff, s.eff).trim()} of this session`
                        : ' · no agents'}
                    </Text>
                  </Box>
                )
              })}
            </Box>

            <Text dimColor wrap="truncate-end">
              Models: {rep.models.map(m => `${m.model} ${share(m.eff, rep.total).trim()}`).join(' · ')}
            </Text>
          </Box>
        )}

        <Box flexDirection="row" gap={1} alignItems="center">
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => void refresh($, { force: true })} />
          <Text dimColor wrap="truncate-end">
            {st.isLoading ? 'counting…' : rep ? `updated ${ago(rep.generatedAt, now)}` : ''}
          </Text>
        </Box>
        {st.error && (
          <Text color="error" wrap="wrap">
            Error: {st.error}
          </Text>
        )}
      </Box>
    )
  })
}
