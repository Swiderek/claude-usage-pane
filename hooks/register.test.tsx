import { expect, test } from 'claude-code/testing'

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
    await ui.unmount()
  }
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
    on('session.start', (_, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/', surface: isInteractive ? 'desktop' : null, isInteractive })

    expect(opened).toBe(opens ? 1 : 0)
    if (!isInteractive) expect(ran).toBe(0)
  })
}
