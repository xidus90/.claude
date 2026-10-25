import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-panel',
  component: 'Pane',
  requestId: 'agent-panel',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'Agents', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const LEAD = {
  id: 'lead:s1', sessionId: 's1', kind: 'lead', name: 'Lead', role: 'lead', task: '', model: 'claude-opus-5-5', effort: 'xhigh',
  tokens: { input: 1000, output: 1000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
  costUsd: 0.024, unpriced: false, firstAt: 0, lastAt: 1000, end: 'answered', errorText: '',
}
const AGENT = { ...LEAD, kind: 'agent', role: 'implementer-backend', model: 'claude-sonnet-5-5', effort: 'medium' }
const N = 1000
const MANY = JSON.stringify({
  runId: 'r1', generations: ['s1'], unreadableLines: 0, problems: [],
  agents: [LEAD, ...Array.from({ length: N }, (_, i) => ({ ...AGENT, id: `a${i}`, name: `impl-T${i}`, task: `impl task number ${i}` }))],
})

test('a card of a large run draws its first rows and names the rest instead of being cut silently', async ($, on) => {
  const clock = mock.clock(on)
  const panes: string[] = []
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/work' }))
  mock.env(on, { USERPROFILE: 'C:/Users/u', TEMP: 'C:/tmp' })
  on('process.run', () => ({ value: { exitCode: 0, stdout: MANY, stderr: '' } }))
  on('agent.list', () => ({ value: [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 1, percent: 0 }, rateLimits: [], cost: { usd: 0.024 } } }))
  on('config.list', () => ({ value: [] }))
  on('ui.open', ($, e) => {
    panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: panes.map((id) => ({ id, title: 'Agents', isShown: true, isFocused: false, isPlaced: true })) }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'agent-panel', args: '' })
  await clock.advance(2000)
  for (const bodyColumns of [50, 120, 200]) {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns } })
    // The host draws only the first 100 000 characters of a terminal pane, so the card names the rows it leaves out.
    const rows = (await ui.findAll({ type: 'Button' })).filter((b) => b.key?.startsWith('r-a'))
    expect(rows.length).toBe(150)
    expect(await ui.find({ type: 'Text', text: '… 850 weitere Agents' })).toBeDefined()
    expect(await ui.find({ key: 'hide-done' })).toBeDefined()
    await ui.unmount()
  }
})
