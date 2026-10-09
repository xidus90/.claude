import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-panel',
  component: 'Pane',
  requestId: 'agent-panel',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const LEAD = {
  id: 'lead:s1', sessionId: 's1', kind: 'lead', name: 'Lead', role: 'lead', task: '', model: 'claude-opus-5-5',
  tokens: { input: 1000, output: 1000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
  costUsd: 0.024, unpriced: false, firstAt: 0, lastAt: 1000, end: 'answered', errorText: '',
}
const GOOD = JSON.stringify({ runId: null, generations: ['s1'], agents: [LEAD], unreadableLines: 0, problems: [] })

type Run = { exitCode: number; stdout: string; stderr: string }

function stub(
  on: Parameters<Parameters<typeof test>[1]>[1],
  runs: string[][],
  answer: () => Run | Promise<Run>,
  opened: string[],
  closed: string[],
  panes: string[],
  deny = '',
  failPanes = (): boolean => false,
): void {
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/work' }))
  mock.env(on, { USERPROFILE: 'C:/Users/u', TEMP: 'C:/tmp' })
  on('process.run', async ($, e) => {
    runs.push(e.argv)
    return deny ? { deny } : { value: await answer() }
  })
  on('agent.list', () => ({ value: [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 1, percent: 0 }, rateLimits: [], cost: { usd: 0.024 } } }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)
    const i = panes.indexOf(e.id)
    if (i >= 0) panes.splice(i, 1)
    return { value: undefined }
  })
  on('ui.panes', () => (failPanes() ? { deny: 'boom' } : { value: panes.map((id) => ({ id })) }))
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const TOGGLE = { command: 'agent-panel', args: '' } as const

test('a session that never opened the panel starts no node', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  stub(on, runs, () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [])
  await $.session.start(START)
  await clock.advance(10_000)
  expect(runs.length).toBe(0)
})

test('the tick runs the summary script with the session and draws its totals', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  stub(on, runs, () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  expect(runs[0]?.slice(2, 4)).toEqual(['--session', 's1'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^≈ \$0\.02/ })).toBeDefined()
})

test('a tick while the script still runs starts no second one', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  stub(on, runs, async () => {
    await clock.sleep(5000)
    return { exitCode: 0, stdout: GOOD, stderr: '' }
  }, [], [], [])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  await clock.advance(2000)
  expect(runs.length).toBe(1)
})

test('/agent-panel opens the pane, and a second time closes it', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  const closed: string[] = []
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), opened, closed, [])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await $.command.run(TOGGLE)
  expect(opened).toEqual(['agent-panel'])
  expect(closed).toEqual(['agent-panel'])
})

test('the first spawned agent opens the pane, later ones do not', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), opened, [], [])
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-sonnet-5-5' }))
  await $.session.start(START)
  await $.agent.spawn({ subagentType: 'implementer-backend', description: 'one', prompt: 'x', isTeammate: true })
  await $.agent.spawn({ subagentType: 'verifier', description: 'two', prompt: 'x', isTeammate: true })
  expect(opened).toEqual(['agent-panel'])
})

test('a failed script shows as a line and keeps the last good totals', async ($, on) => {
  const clock = mock.clock(on)
  let call = 0
  stub(on, [], () => (++call === 1 ? { exitCode: 0, stdout: GOOD, stderr: '' } : { exitCode: 1, stdout: '', stderr: 'boom' }), [], [], [])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '⚠ summarize exit 1: boom' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^≈ \$0\.02/ })).toBeDefined()
})

test('a missing node shows as a line', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [], 'spawn node ENOENT')
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^⚠ node nicht gefunden/ })).toBeDefined()
})

test('a group button folds its rows away', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'r-lead:s1' })).toBeDefined()
  await ui.press({ key: 'g-lead' })
  expect(await ui.find({ key: 'r-lead:s1' })).toBeUndefined()
})

test('a row button shows and hides its token breakdown', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const detail = { type: 'Text', text: /^ {6}in 1k · out 1k · read 0 · write 0\/0$/ } as const
  expect(await ui.find(detail)).toBeUndefined()
  await ui.press({ key: 'r-lead:s1' })
  expect(await ui.find(detail)).toBeDefined()
  await ui.press({ key: 'r-lead:s1' })
  expect(await ui.find(detail)).toBeUndefined()
})

test('closing the pane stops the tick from starting node', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  stub(on, runs, () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const before = runs.length
  await $.command.run(TOGGLE)
  await clock.advance(4000)
  expect(before).toBe(2)
  expect(runs.length).toBe(before)
})

test('a failed pane listing does not stop later ticks', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  const panes: string[] = []
  let hasFailed = false
  stub(on, runs, () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], panes, '', () => {
    if (hasFailed || panes.length === 0) return false
    hasFailed = true
    return true
  })
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  await clock.advance(2000)
  expect(runs.length).toBeGreaterThan(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^≈ \$0\.02/ })).toBeDefined()
})
