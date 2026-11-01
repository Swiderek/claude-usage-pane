import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { UsageReport } from '../types'

const NOW = Date.parse('2026-11-01T08:00:00Z')

const PANE = {
  plugin: 'usage-pane',
  component: 'Pane',
  requestId: 'usage-pane',
  props: {
    title: 'Usage',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const REPORT: UsageReport = {
  since: '2026-10-28T10:00:00Z',
  isRolling: false,
  generatedAt: NOW,
  total: 700_000_000,
  subTotal: 560_000_000,
  sessions: 53,
  agents: 482,
  sessionsWithAgents: 12,
  projects: [{ label: 'example-app', path: '~/code/example-app', eff: 199_000_000, subEff: 175_000_000 }],
  topSessions: [
    { title: 'Refactor the billing module', project: 'example-app', eff: 199_000_000, subEff: 175_000_000, agents: 61 },
  ],
  models: [{ model: 'opus-5-5', eff: 527_000_000 }],
}

const USAGE = {
  startedAt: NOW,
  context: { window: 1_000_000 },
  rateLimits: [{ kind: 'seven_day', percentUsed: 82, resetsAt: '2026-11-04T10:00:00Z' }],
}

const RAN = {
  exitCode: 0,
  stdout: JSON.stringify(REPORT),
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
}

test('Refresh fills the pane from the script, on every surface', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: USAGE }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('process.run', () => ({ value: RAN }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })

    expect(await ui.find({ type: 'Text', text: /Refactor the billing module/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^Week/ }))?.text).toContain('82%')
    expect((await ui.find({ type: 'Text', text: /61 agents/ }))?.text).toContain('88% of this session')
    const split = await ui.find({ type: 'Text', text: /agents 80%/ })
    expect(split?.text).toContain('you 20%')
    expect(await ui.find({ type: 'Text', text: /482 agents in 12 of 53 sessions/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Since Oct 28/ })).toBeDefined()
    // The split bar stays inside the pane: 60% of its 48 columns, so it
    // cannot wrap where the surface draws glyphs wider than a column.
    const split48 = await ui.find({ type: 'Text', text: /^[█▓]+$/ })
    expect(split48?.text.length).toBe(28)
    await ui.unmount()
  }

  // The same counted report stays off the phone.
  const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await phone.find({ type: 'Text', text: /hidden on the phone/ })).toBeDefined()
  expect(await phone.find({ type: 'Text', text: /Refactor the billing module/ })).toBeUndefined()
  expect(await phone.find({ type: 'Text', text: /example-app/ })).toBeUndefined()
  await phone.unmount()
})

test('one agent and one session read in the singular', async ($, on) => {
  const one: UsageReport = {
    ...REPORT,
    sessions: 1,
    agents: 1,
    sessionsWithAgents: 1,
    topSessions: [{ ...REPORT.topSessions[0]!, agents: 1, subEff: 64_000_000 }],
  }
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: USAGE }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('process.run', () => ({ value: { ...RAN, stdout: JSON.stringify(one) } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /1 agent in 1 of 1 session$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /1 agent,/ }))?.text).toContain('1 agent, 32% of this session')
  expect((await ui.find({ type: 'Text', text: /effective/ }))?.text).toContain('· 1 session')
  await ui.unmount()
})

test('a store that refuses does not stop the count', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: USAGE }))
  on('store.get', () => {
    throw new Error('no store')
  })
  on('store.set', () => {
    throw new Error('no store')
  })
  on('process.run', () => ({ value: RAN }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /Refactor the billing module/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Error/ })).toBeUndefined()
  await ui.unmount()
})

// NOW is 94 h into the week (56%): resets 2026-11-04 10:00, 74 h away.
const PACE_CASES = [
  { percentUsed: 82, resetsAt: '2026-11-04T10:00:00Z', expected: 'too fast (56% of week gone, runs out in 20h 38m)' },
  { percentUsed: 70, resetsAt: '2026-11-04T10:00:00Z', expected: 'fast (56% of week gone, runs out in 1d 16h)' },
  { percentUsed: 50, resetsAt: '2026-11-04T10:00:00Z', expected: 'on track (56% of week gone)' },
  { percentUsed: 100, resetsAt: '2026-11-04T10:00:00Z', expected: 'limit reached' },
  // Six hours into the week: too early to judge, so no row.
  { percentUsed: 9, resetsAt: '2026-11-08T02:00:00Z', expected: null },
] as const

for (const { percentUsed, resetsAt, expected } of PACE_CASES) {
  test(`pace at ${percentUsed}% resetting ${resetsAt}`, async ($, on) => {
    on('clock.now', () => ({ value: NOW }))
    on('session.usage', () => ({
      value: { ...USAGE, rateLimits: [{ kind: 'seven_day', percentUsed, resetsAt }] },
    }))
    on('store.get', () => ({ value: undefined }))
    on('store.set', () => ({ value: undefined }))
    on('process.run', () => ({ value: RAN }))

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'refresh' })

    const row = await ui.find({ type: 'Text', text: /^Pace/ })
    if (expected === null) expect(row).toBeUndefined()
    else expect(row?.text).toBe(`Pace: ${expected}`)
    await ui.unmount()
  })
}

test('a failing script shows its last line as the error', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: USAGE }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('process.run', () => ({
    value: { ...RAN, exitCode: 1, stdout: '', stderr: 'Traceback\nPermissionError: denied' },
  }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect((await ui.find({ type: 'Text', text: /^Error/ }))?.text).toContain('denied')
  expect(await ui.find({ type: 'Text', text: /No data yet/ })).toBeDefined()
  await ui.unmount()
})

for (const { name, isInteractive, panel, opens } of [
  { name: 'opens the pane at start', isInteractive: true, panel: 'auto', opens: true },
  { name: 'leaves the pane to the command when asked to', isInteractive: true, panel: 'command', opens: false },
  { name: 'stays out of a -p run', isInteractive: false, panel: 'auto', opens: false },
] as const) {
  test(name, { options: { panel } }, async ($, on) => {
    let opened = 0
    let ran = 0
    on('command.register', () => ({ value: { command: 'usage-pane' } }))
    on('ui.open', () => ((opened += 1), { value: { isPlaced: true } }))
    on('clock.every', () => ({ value: undefined }))
    on('clock.now', () => ({ value: NOW }))
    on('session.usage', () => ({ value: USAGE }))
    on('store.get', () => ({ value: undefined }))
    on('store.set', () => ({ value: undefined }))
    on('process.run', () => ((ran += 1), { value: RAN }))
    on('session.surfaces', () => ({ value: isInteractive ? ['terminal'] : [] }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/', surface: isInteractive ? 'terminal' : null, isInteractive })

    expect(opened).toBe(opens ? 1 : 0)
    if (!isInteractive) expect(ran).toBe(0)
  })
}

test('the desktop app attaching opens the pane and starts counting, once', async ($, on) => {
  let opened = 0
  let timers = 0
  on('command.register', () => ({ value: { command: 'usage-pane' } }))
  on('ui.open', () => ((opened += 1), { value: { isPlaced: true } }))
  on('clock.every', () => ((timers += 1), { value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: USAGE }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('process.run', () => ({ value: RAN }))
  // A session the desktop app hosts starts with nobody attached yet.
  on('session.surfaces', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))

  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  expect(opened).toBe(0)

  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:phone' })

  expect(opened).toBe(1)
  expect(timers).toBe(1)
})

function pythonRun(argv: readonly string[], missing: readonly string[], absent: readonly string[]) {
  if (absent.includes(argv[0] ?? '')) throw new Error('spawn ENOENT')
  if (missing.includes(argv[0] ?? '')) {
    return {
      value: {
        ...RAN,
        exitCode: 9009,
        stdout: '',
        stderr: 'Python was not found; run without arguments to install from the Microsoft Store',
      },
    }
  }

  return { value: RAN }
}

test('the Microsoft Store stand-in for python3 is skipped for the py launcher', async ($, on) => {
  const tried: string[] = []
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: USAGE }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('process.run', (_, e) => (tried.push(e.argv.slice(0, 2).join(' ')), pythonRun(e.argv, ['python3'], [])))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect(tried).toEqual(['python3 -I', 'py -3'])
  expect(await ui.find({ type: 'Text', text: /Refactor the billing module/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Error/ })).toBeUndefined()
  await ui.unmount()
})

test('no Python at all says how to install it', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: USAGE }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('process.run', (_, e) => pythonRun(e.argv, ['python3', 'python'], ['py', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3']))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect((await ui.find({ type: 'Text', text: /^Error/ }))?.text).toContain('Python 3 was not found')
  expect((await ui.find({ type: 'Text', text: /^Error/ }))?.text).toContain('winget install Python.Python.3.13')
  await ui.unmount()
})

const BAND = {
  plugin: 'usage-pane',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

/** The engine's own drawing, beneath the plugin: what a quiet band leaves to it. */
function engineDraws(on: Parameters<TestBody>[1]) {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
}

function counted(on: Parameters<TestBody>[1]) {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: USAGE }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('process.run', () => ({ value: RAN }))
}

async function countNow($: Parameters<TestBody>[0]) {
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'refresh' })
  await pane.unmount()
}

test('the band sums up the week and opens the pane, on every surface', async ($, on) => {
  const opens: { id: string; focus?: true }[] = []
  counted(on)
  on('ui.open', (_, e) => (opens.push({ id: e.id, focus: e.focus }), { value: { isPlaced: true } }))
  await countNow($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })

    expect((await band.find({ type: 'Text', text: /^Week/ }))?.text).toBe(
      'Week 82% · too fast, runs out in 20h 38m · agents 80%',
    )
    await band.press({ key: 'open-usage' })
    expect(opens.at(-1)).toEqual({ id: 'usage-pane', focus: true })
    await band.unmount()
  }
})

test('the band stays out of the way until there is something to show', async ($, on) => {
  counted(on)
  engineDraws(on)

  // Nothing counted yet.
  const early = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await early.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await early.unmount()

  await countNow($)

  // A survey needs the room; the phone gets no usage.
  for (const mount of [
    { ...BAND, surface: 'desktop', props: { ...BAND.props, hasSurvey: true } },
    { ...BAND, surface: 'mobile' },
  ] as const) {
    const band = await $.ui.mount(mount)
    expect(await band.find({ type: 'Text', text: /engine/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /Week/ })).toBeUndefined()
    await band.unmount()
  }
})

test('the band can be turned off', { options: { band: 'off' } }, async ($, on) => {
  counted(on)
  engineDraws(on)
  await countNow($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /engine/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /Week/ })).toBeUndefined()
  await band.unmount()
})
