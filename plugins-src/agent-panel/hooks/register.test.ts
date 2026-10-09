import { expect, mock, test } from 'claude-code/testing'
import { DARK, LIGHT } from './art.ts'

const PANE = {
  plugin: 'agent-panel',
  component: 'Pane',
  requestId: 'agent-panel',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const LEAD = {
  id: 'lead:s1', sessionId: 's1', kind: 'lead', name: 'Lead', role: 'lead', task: '', model: 'claude-opus-5-5', effort: 'xhigh',
  tokens: { input: 1000, output: 1000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
  costUsd: 0.024, unpriced: false, firstAt: 0, lastAt: 1000, end: 'answered', errorText: '',
}
const GOOD = JSON.stringify({ runId: null, generations: ['s1'], agents: [LEAD], unreadableLines: 0, problems: [] })
const AGENT = { ...LEAD, id: 'a1', kind: 'agent', name: 'impl-T1', role: 'implementer-backend', task: 'impl T1', model: 'claude-sonnet-5-5', effort: 'medium' }
const TEAM = JSON.stringify({ runId: 'r1', generations: ['s1'], agents: [LEAD, AGENT], unreadableLines: 0, problems: [] })
const UNPRICED = JSON.stringify({ runId: 'r1', generations: ['s1'], agents: [LEAD, { ...AGENT, model: 'x-unknown', costUsd: 0, unpriced: true }], unreadableLines: 0, problems: [] })
// Terminal cells a keyed element draws: the glyphs of its text.
const cellsOf = (el: { text: string } | undefined): number => [...(el?.text ?? '')].length
const WIDE = (surface: 'terminal' | 'desktop') => ({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 80 } })
const NARROW = (surface: 'terminal' | 'desktop') => ({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 50 } })

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
  expect(await ui.find({ type: 'Text', text: /^Kosten ≈ \$0\.02/ })).toBeDefined()
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
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '⚠ summarize exit 1: boom' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Kosten ≈ \$0\.02/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /^Kosten ≈ \$0\.02/ })).toBeDefined()
})

test('the desktop draws SVG pieces and a crab per role when wide', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [{ key: 'theme', value: 'dark' }] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('desktop'))
  expect(await ui.find({ key: 'svg-tiles' })).toBeDefined()
  expect(await ui.find({ key: 'crab-implementer-backend' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn.includes(DARK.tile)).toBe(true)
  expect(drawn.includes(LIGHT.tile)).toBe(false)
  await ui.unmount()
  const narrow = await $.ui.mount(NARROW('desktop'))
  expect(await narrow.find({ key: 'crab-implementer-backend' })).toBeUndefined()
})

test('the terminal draws block bars and raster crabs when wide', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('terminal'))
  expect(await ui.find({ key: 'crab-implementer-backend' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
})

test('the section buttons fold the overview and the agents, and hide finished rows', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(NARROW('terminal'))
  expect(await ui.find({ type: 'Text', text: /^Kosten ≈/ })).toBeDefined()
  await ui.press({ key: 'sec-overview' })
  expect(await ui.find({ type: 'Text', text: /^Kosten ≈/ })).toBeUndefined()
  expect(await ui.find({ key: 'r-a1' })).toBeDefined()
  await ui.press({ key: 'hide-done' })
  expect(await ui.find({ key: 'r-a1' })).toBeUndefined()
  await ui.press({ key: 'sec-agents' })
  expect(await ui.find({ key: 'g-implementer-backend' })).toBeUndefined()
})

test('the terminal bars fit the card body beside the crab', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('terminal'))
  const card = await ui.find({ key: 'card-implementer-backend' })
  const crab = await ui.find({ key: 'crab-implementer-backend' })
  // 80 columns less the card's border and padding, the crab and the gap beside it.
  const room = 80 - 2 - 2 * Number(card?.props.paddingX) - Number(crab?.props.columns) - Number(card?.props.columnGap)
  expect(cellsOf(await ui.find({ key: 'cost-implementer-backend' }))).toBe(room)
  expect(cellsOf(await ui.find({ key: 'stripe-a1' }))).toBe(room)
})

test('an unpriced agent is named beside the totals on both surfaces', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: UNPRICED, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const terminal = await $.ui.mount(NARROW('terminal'))
  expect(await terminal.find({ type: 'Text', text: 'ohne 1 Agents' })).toBeDefined()
  await terminal.unmount()
  const desktop = await $.ui.mount(NARROW('desktop'))
  expect(await desktop.find({ type: 'Text', text: 'ohne 1 Agents' })).toBeDefined()
})

test('fold all and unfold all close and open every group', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(NARROW('terminal'))
  await ui.press({ key: 'fold-all' })
  expect(await ui.find({ key: 'r-a1' })).toBeUndefined()
  expect(await ui.find({ key: 'r-lead:s1' })).toBeUndefined()
  expect(await ui.find({ key: 'g-implementer-backend' })).toBeDefined()
  await ui.press({ key: 'open-all' })
  expect(await ui.find({ key: 'r-a1' })).toBeDefined()
  expect(await ui.find({ key: 'r-lead:s1' })).toBeDefined()
})

test('a new team run reopens the panel after it was closed', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), opened, [], [])
  on('config.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-sonnet-5-5' }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await $.command.run(TOGGLE)
  await $.agent.spawn({ subagentType: 'implementer-backend', description: 'x', prompt: 'x', isTeammate: true })
  expect(opened).toEqual(['agent-panel', 'agent-panel'])
})

test('a drawing that throws falls back to the text tree with a warning', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  // A width past any string length makes the block bars throw a RangeError.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 1e13 } })
  expect(await ui.find({ type: 'Text', text: /^⚠ Grafik: / })).toBeDefined()
  expect(await ui.find({ key: 'g-implementer-backend' })).toBeDefined()
  expect(await ui.find({ key: 'sec-overview' })).toBeUndefined()
})

test('a denied pane listing still lets the first spawn open the pane', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), opened, [], [], '', () => true)
  on('config.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-sonnet-5-5' }))
  await $.session.start(START)
  await $.agent.spawn({ subagentType: 'implementer-backend', description: 'x', prompt: 'x', isTeammate: true })
  expect(opened).toEqual(['agent-panel'])
})

test('a denied pane listing still loads the summary into the pane the spawn opened', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  stub(on, runs, () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [], '', () => true)
  on('config.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-sonnet-5-5' }))
  await $.session.start(START)
  await $.agent.spawn({ subagentType: 'implementer-backend', description: 'x', prompt: 'x', isTeammate: true })
  await clock.advance(2000)
  expect(runs.length).toBeGreaterThan(0)
  const ui = await $.ui.mount(NARROW('terminal'))
  expect(await ui.find({ type: 'Text', text: /^Kosten ≈ \$0\.05/ })).toBeDefined()
})

test('a denied pane listing does not reopen the pane on every spawn of a swarm', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), opened, [], [], '', () => true)
  on('config.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-sonnet-5-5' }))
  await $.session.start(START)
  for (let i = 0; i < 4; i++) await $.agent.spawn({ subagentType: 'verifier', description: 'x', prompt: 'x' })
  expect(opened).toEqual(['agent-panel'])
})

test('a failed theme read falls back to the light palette and still draws', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ deny: 'no config' }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('desktop'))
  // A failed theme read falls back to light and still draws.
  expect(await ui.find({ key: 'svg-tiles' })).toBeDefined()
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn.includes(LIGHT.tile)).toBe(true)
  expect(drawn.includes(DARK.tile)).toBe(false)
})
