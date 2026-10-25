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
// One escape sequence in a text makes the host refuse the whole tree.
const DIRTY_AGENT = { ...AGENT, name: 'impl \u001b[31mT1\nnext', task: 'impl \u001b[31mT1\nnext', model: 'x\u001b]0;title\u0007', effort: '\u001b[31mhigh\r\nX', end: 'error', errorText: 'boom\u001b[2J\r\nY' }
const DIRTY = JSON.stringify({ runId: 'r1', generations: ['s1'], agents: [LEAD, DIRTY_AGENT], unreadableLines: 0, problems: [] })
// An id comes from a file name, so it can hold anything; it only ever serves as a key.
const DIRTY_ID = JSON.stringify({ runId: 'r1', generations: ['s1'], agents: [LEAD, { ...AGENT, id: 'x\u001b[31m1' }], unreadableLines: 0, problems: [] })
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
  sessions = (): object[] => [],
  lists: string[][] = [],
): void {
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/work' }))
  mock.env(on, { USERPROFILE: 'C:/Users/u', TEMP: 'C:/tmp', CLAUDE_CONFIG_DIR: 'C:/Users/u/.claude-b' })
  on('process.run', async ($, e) => {
    // The session list is a call of its own; `runs` counts the summaries.
    if (e.argv.includes('--list')) {
      lists.push(e.argv)
      try {
        return { value: { exitCode: 0, stdout: JSON.stringify(sessions()), stderr: '' } }
      } catch (err) {
        // A list that cannot be made fails the call itself, as a timeout does.
        return { deny: String(err) }
      }
    }
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
  // A second account runs Claude Code from its own config folder; its transcripts live there.
  expect(runs[0]?.slice(6, 8)).toEqual(['--config', 'C:/Users/u/.claude-b'])
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

test('the desktop draws SVG pieces and a crab per role at any width', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [{ key: 'theme', value: 'dark' }] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('desktop'))
  expect(await ui.find({ key: 'tiles' })).toBeDefined()
  expect(await ui.find({ key: 'crab-implementer-backend' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn.includes(DARK.tile)).toBe(true)
  expect(drawn.includes(LIGHT.tile)).toBe(false)
  await ui.unmount()
  // The desktop lays out in pixels, so a pane of few columns still has room for the crab.
  const narrow = await $.ui.mount(NARROW('desktop'))
  expect(await narrow.find({ key: 'crab-implementer-backend' })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /▄/ })).toBeDefined()
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

test('a role whose agents are all done keeps its head and cost bar when finished rows are hidden', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(NARROW('terminal'))
  await ui.press({ key: 'hide-done' })
  expect(await ui.find({ key: 'g-implementer-backend' })).toBeDefined()
  expect(await ui.find({ key: 'cost-implementer-backend' })).toBeDefined()
  expect(await ui.find({ key: 'r-a1' })).toBeUndefined()
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

test('a denied pane listing still reopens the pane for a new team run after it was closed', async ($, on) => {
  const clock = mock.clock(on)
  const opened: string[] = []
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), opened, [], [], '', () => true)
  on('config.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-sonnet-5-5' }))
  await $.session.start(START)
  await $.agent.spawn({ subagentType: 'implementer-backend', description: 'x', prompt: 'x', isTeammate: true })
  await $.command.run(TOGGLE)
  await clock.advance(11 * 60_000)
  await $.agent.spawn({ subagentType: 'implementer-backend', description: 'x', prompt: 'x', isTeammate: true })
  expect(opened).toEqual(['agent-panel', 'agent-panel'])
})

test('a denied pane listing stops the summary once the pane was closed', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  stub(on, runs, () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [], '', () => true)
  on('config.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-sonnet-5-5' }))
  await $.session.start(START)
  await $.agent.spawn({ subagentType: 'implementer-backend', description: 'x', prompt: 'x', isTeammate: true })
  await clock.advance(2000)
  expect(runs.length).toBeGreaterThan(0)
  await $.command.run(TOGGLE)
  const before = runs.length
  await clock.advance(10_000)
  expect(runs.length).toBe(before)
})

test('an escape sequence in an agent name does not make the host refuse the pane, and the name shows cleaned', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: DIRTY, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(NARROW(surface))
    expect((await ui.find({ key: 'r-a1' }))?.props.label).toBe('impl [31mT1 next')
    expect(await ui.find({ type: 'Text', text: /boom \[2J Y$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('an escape sequence in an agent id does not make the host refuse the pane, and no Svg alt carries a key', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: DIRTY_ID, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(NARROW(surface))
    expect(await ui.find({ key: 'r-x\u001b[31m1' })).toBeDefined()
    await ui.unmount()
  }
  // The wide scene draws every kind of Svg, and none of them names a key: status, cost and token bars, crabs, the rule.
  const drawn = JSON.stringify(await (await $.ui.mount(WIDE('desktop'))).drawn())
  const alts = [...new Set([...drawn.matchAll(/"alt":"([^"]*)"/g)].map((m) => m[1]))].sort()
  expect(alts).toEqual([
    'Kostenanteil', 'Krabbe Lead (Orchestrator)', 'Krabbe implementer-backend', 'Statusverteilung', 'Tokenverteilung', 'Trennlinie',
  ])
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
  expect(await ui.find({ key: 'tiles' })).toBeDefined()
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn.includes(LIGHT.tile)).toBe(true)
  expect(drawn.includes(DARK.tile)).toBe(false)
})

// summarize writes a non-finite cost as null.
const NULL_COST = JSON.stringify({ runId: null, generations: ['s1'], agents: [{ ...LEAD, costUsd: null }], unreadableLines: 0, problems: [] })

test('a summary with a null cost still draws, as an unpriced agent, on both surfaces', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: NULL_COST, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(NARROW(surface))
    expect(await ui.find({ type: 'Text', text: 'ohne 1 Agents' })).toBeDefined()
    expect(await ui.find({ key: 'sec-overview' })).toBeDefined()
    await ui.unmount()
  }
})

test('a summary without its lists is refused with a line and keeps the last good one', async ($, on) => {
  const clock = mock.clock(on)
  let call = 0
  stub(on, [], () => ({ exitCode: 0, stdout: ++call === 1 ? GOOD : '{"agents":[]}', stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  await clock.advance(2000)
  const ui = await $.ui.mount(NARROW('terminal'))
  expect(await ui.find({ type: 'Text', text: '⚠ summarize: unerwartete Ausgabe' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Kosten ≈ \$0\.02/ })).toBeDefined()
})

test('a view that cannot be built leaves a warning instead of a blank pane', async ($, on) => {
  let isClockBroken = false
  on('clock.now', () => (isClockBroken ? { deny: 'no clock' } : { value: 0 }))
  on('clock.every', () => new Promise<never>(() => {}))
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  isClockBroken = true
  const ui = await $.ui.mount(NARROW('terminal'))
  // The Grafik line is for a drawing that throws; without a view there is nothing to draw.
  expect(await ui.find({ type: 'Text', text: /^⚠ .*no clock/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^⚠ Grafik: / })).toBeUndefined()
})

test('each agent row of a card keeps a blank line above it, after the cost bar and between agents', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('terminal'))
  const rows = (await ui.findAll({ type: 'Box' })).filter((b) => b.key?.startsWith('row-'))
  expect(rows.length).toBeGreaterThan(0)
  for (const r of rows) expect(r.props.marginTop).toBe(1)
})

test('an open role card keeps its crab at the size of a folded one', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('desktop'))
  const crab = await ui.find({ key: 'crab-implementer-backend' })
  // The rows beside it would squeeze it otherwise.
  expect(crab?.props.flexShrink).toBe(0)
  const svg = (crab?.children ?? []).find((c) => typeof c === 'object' && c !== null && (c as { type?: string }).type === 'Svg') as { props: Record<string, unknown> } | undefined
  expect([svg?.props.width, svg?.props.height]).toEqual([36, 34])
})

test('the role cards keep a line of space between them, and the Agents block one above its rule', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(WIDE(surface))
    expect((await ui.find({ key: 'cards' }))?.props.rowGap).toBe(1)
    expect((await ui.find({ key: 'rule-agents' }))?.props.marginTop).toBe(1)
    // A little room below the rule, before the Agents heading.
    expect((await ui.find({ key: 'rule-agents' }))?.props.marginBottom).toBe(1)
    // And below the buttons, before the status bar.
    expect((await ui.find({ key: 'status-room' }))?.props.marginTop).toBe(1)
    await ui.unmount()
  }
})

test('a narrow pane puts the Agents buttons on a row of their own that wraps', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const sameRow = async () => {
    const head = await ui.find({ key: 'agents-head' })
    return JSON.stringify(head?.children ?? []).includes('"agents-tools"')
  }
  let ui = await $.ui.mount(NARROW('terminal'))
  expect((await ui.find({ key: 'agents-tools' }))?.props.flexWrap).toBe('wrap')
  expect(await sameRow()).toBe(false)
  await ui.unmount()
  ui = await $.ui.mount(WIDE('terminal'))
  expect(await sameRow()).toBe(true)
})

const TWO_GENS = JSON.stringify({ runId: 'r1', generations: ['s1', 's2'], agents: [LEAD, { ...LEAD, id: 'lead:s2', sessionId: 's2' }, AGENT], unreadableLines: 0, problems: [] })

async function shown($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], stdout: string, theme = 'dark') {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [{ key: 'theme', value: theme }] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
}

test('the title names the run and, dimmed after a dot, its generations', async ($, on) => {
  await shown($, on, TWO_GENS)
  const ui = await $.ui.mount(NARROW('terminal'))
  expect(await ui.find({ type: 'Text', text: 'Lauf r1' })).toBeDefined()
  const gens = await ui.find({ type: 'Text', text: ' · Gen 1–2' })
  expect(gens?.props.dimColor).toBe(true)
})

test('the desktop stretches every SVG piece to the pane at a fixed height', async ($, on) => {
  await shown($, on, TEAM)
  const ui = await $.ui.mount(NARROW('desktop'))
  const svgs = (await ui.findAll({ type: 'Svg' })).filter((s) => !String(s.props.alt).startsWith('Krabbe'))
  expect(svgs.length).toBeGreaterThan(0)
  for (const s of svgs) expect(typeof s.props.height).toBe('number')
})

test('the section heads read in capitals, and a rule sets the Agents section apart', async ($, on) => {
  await shown($, on, TEAM)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(NARROW(surface))
    expect(await ui.find({ type: 'Text', text: '▾ ÜBERSICHT' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▾ AGENTS' })).toBeDefined()
    expect(await ui.find({ key: 'rule-agents' })).toBeDefined()
    await ui.unmount()
  }
})

test('the legend and the status line colour each part and spread over the width', async ($, on) => {
  await shown($, on, TEAM)
  const ui = await $.ui.mount(NARROW('terminal'))
  expect((await ui.find({ key: 'legend' }))?.props.justifyContent).toBe('space-between')
  expect((await ui.find({ key: 'status-line' }))?.props.justifyContent).toBe('space-between')
  expect((await ui.find({ type: 'Text', text: '✓ fertig 1' }))?.props.color).toBe('#2f8a52')
  expect((await ui.find({ type: 'Text', text: '■ ' }))?.props.color).toBe('#8f8cf4')
  expect((await ui.find({ type: 'Text', text: '2k' }))?.props.bold).toBe(true)
})

test('a role head colours its counts', async ($, on) => {
  await shown($, on, TEAM)
  const ui = await $.ui.mount(NARROW('terminal'))
  const head = await ui.find({ key: 'g-implementer-backend' })
  expect(JSON.stringify(head)).toContain('#2f8a52')
})

test('an agent row puts its model, cost and time at the right edge', async ($, on) => {
  await shown($, on, TEAM)
  const ui = await $.ui.mount(NARROW('terminal'))
  const line = await ui.find({ key: 'line-a1' })
  expect(line?.props.justifyContent).toBe('space-between')
})

test('the desktop gives the cards a background and border of the palette, the terminal neither', async ($, on) => {
  await shown($, on, TEAM)
  const desktop = await $.ui.mount(NARROW('desktop'))
  const card = await desktop.find({ key: 'card-implementer-backend' })
  expect([card?.props.backgroundColor, card?.props.borderColor]).toEqual([DARK.card, DARK.border])
  await desktop.unmount()
  const terminal = await $.ui.mount(NARROW('terminal'))
  expect((await terminal.find({ key: 'card-implementer-backend' }))?.props.backgroundColor).toBeUndefined()
})

test('the Agents tools are real buttons, and hiding finished rows marks its button as on', async ($, on) => {
  await shown($, on, TEAM)
  const ui = await $.ui.mount(NARROW('desktop'))
  expect((await ui.find({ key: 'hide-done' }))?.props.plain).toBeUndefined()
  expect((await ui.find({ key: 'hide-done' }))?.props.variant).toBe('secondary')
  await ui.press({ key: 'hide-done' })
  expect((await ui.find({ key: 'hide-done' }))?.props.variant).toBe('primary')
})

const OTHER = { id: 's2', config: 'C:/Users/u/.claude-b', project: 'repo', title: 'Agent-team fortsetzen', cwd: 'C:/repo', lastAt: 0, isLive: false }

test('the title row offers this and the recent sessions in a Select', async ($, on) => {
  const clock = mock.clock(on)
  const lists: string[][] = []
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [], '', () => false, () => [OTHER, { ...OTHER, id: 's1' }], lists)
  await $.session.start(START)
  await clock.advance(10_000)
  expect(lists.length).toBe(0)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  expect(lists[0]?.slice(2)).toEqual(['--list', '--home', 'C:/Users/u', '--config', 'C:/Users/u/.claude-b'])
  const ui = await $.ui.mount(WIDE('terminal'))
  const select = await ui.find({ key: 'session' })
  expect(select?.type).toBe('Select')
  const options = select?.props.options as { value: string; label: string }[]
  // The own session stands first under its own name, not again among the others.
  expect(options.map((o) => o.value)).toEqual(['', 's2'])
  expect(options[0]?.label).toBe('Diese Sitzung')
  expect(options[1]?.label).toMatch(/^○ Agent-team fortsetzen · repo · .* · b$/)
})

test('picking another session summarizes its transcript with its own config and cwd', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  stub(on, runs, () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [], '', () => false, () => [OTHER])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('terminal'))
  await ui.select({ key: 'session', value: 's2' })
  await clock.advance(2000)
  const last = runs[runs.length - 1] ?? []
  expect(last.slice(2, 8)).toEqual(['--session', 's2', '--cwd', 'C:/repo', '--config', 'C:/Users/u/.claude-b'])
  expect(await ui.find({ type: 'Text', text: 'Sitzung: Agent-team fortsetzen' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'nur aus dem Transkript' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /gemeldet/ })).toBeUndefined()
  // A long title shrinks; the picker keeps its width and stays in reach.
  expect((await ui.find({ key: 'title' }))?.props.flexShrink).toBe(1)
  expect((await ui.find({ key: 'picker-row' }))?.props.justifyContent).toBe('flex-end')
  // The token bar keeps a line of space below the tiles.
  expect((await ui.find({ key: 'stripe-room' }))?.props.marginTop).toBe(1)
})

test('a picked session that only left the 20 newest stays picked', async ($, on) => {
  const clock = mock.clock(on)
  let sessions: object[] = [OTHER]
  const runs: string[][] = []
  stub(on, runs, () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [], '', () => false, () => sessions)
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('terminal'))
  await ui.select({ key: 'session', value: 's2' })
  sessions = []
  await clock.advance(10_000)
  await clock.advance(2000)
  expect((runs[runs.length - 1] ?? []).slice(2, 4)).toEqual(['--session', 's2'])
  const options = (await ui.find({ key: 'session' }))?.props.options as { value: string }[]
  expect(options.map((o) => o.value)).toEqual(['', 's2'])
})

test('a picked session whose transcript is gone falls back to this one with a notice', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  const gone = JSON.stringify({ runId: null, generations: ['s2'], agents: [], unreadableLines: 0, problems: ['kein Transkript für Sitzung s2'] })
  stub(on, runs, () => ({ exitCode: 0, stdout: runs[runs.length - 1]?.includes('s2') ? gone : GOOD, stderr: '' }), [], [], [], '', () => false, () => [OTHER])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('terminal'))
  await ui.select({ key: 'session', value: 's2' })
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /Agent-team fortsetzen.*nicht mehr/ })).toBeDefined()
  await clock.advance(2000)
  expect((runs[runs.length - 1] ?? []).slice(2, 4)).toEqual(['--session', 's1'])
  expect(await ui.find({ type: 'Text', text: 'Diese Sitzung' })).toBeDefined()
})

test('a failing list call keeps the summary and shows no warning', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  stub(on, runs, () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [], '', () => false, () => { throw new Error('list broke') })
  await $.session.start(START)
  await $.command.run(TOGGLE)
  // The open's own refresh, before any tick: the failed list must not cost its summary.
  await clock.advance(1)
  expect(runs.length).toBe(1)
  const ui = await $.ui.mount(WIDE('terminal'))
  expect(await ui.find({ type: 'Text', text: /^Kosten ≈ \$0\.02/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^⚠/ })).toBeUndefined()
})

test('the session picker stands on a row of its own under the title, right-aligned, on every width', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [], '', () => false, () => [OTHER])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const head = async () => JSON.stringify((await ui.find({ key: 'title-row' }))?.children ?? [])
  let ui = await $.ui.mount(NARROW('terminal'))
  expect(await head()).not.toContain('"session"')
  expect(await ui.find({ key: 'session' })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(WIDE('terminal'))
  expect(await head()).not.toContain('"session"')
  expect((await ui.find({ key: 'picker-row' }))?.props.justifyContent).toBe('flex-end')
})
