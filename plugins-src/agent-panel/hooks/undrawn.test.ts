import { expect, mock, test } from 'claude-code/testing'

const LEAD = {
  id: 'lead:s1', sessionId: 's1', kind: 'lead', name: 'Lead', role: 'lead', task: '', model: 'claude-opus-5-5', effort: 'xhigh',
  tokens: { input: 1000, output: 1000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
  costUsd: 0.024, unpriced: false, firstAt: 0, lastAt: 1000, end: 'answered', errorText: '',
}
const TEAM = JSON.stringify({ runId: 'r1', generations: ['s1'], agents: [LEAD], unreadableLines: 0, problems: [] })

type Pane = { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }

test('/agent-panel places a pane the first teammate opened undrawn on a narrow terminal instead of closing it', async ($, on) => {
  mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/work' }))
  mock.env(on, { USERPROFILE: 'C:/Users/u', TEMP: 'C:/tmp' })
  on('process.run', () => ({ value: { exitCode: 0, stdout: TEAM, stderr: '' } }))
  on('agent.list', () => ({ value: [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 1, percent: 0 }, rateLimits: [], cost: { usd: 0.024 } } }))
  on('config.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-sonnet-5-5' }))
  // A 120-column terminal: an unasked open waits undrawn (below 144), an asked one is placed.
  const opened: boolean[] = []
  const closed: string[] = []
  let panes: Pane[] = []
  on('ui.open', ($, e) => {
    const isPlaced = e.focus === true
    opened.push(isPlaced)
    panes = [{ id: e.id, title: 'Agents', isShown: isPlaced, isFocused: isPlaced, isPlaced }]
    return { value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'unasked panes are placed from 144 columns; 120 now' } }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)
    panes = []
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: panes }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.agent.spawn({ subagentType: 'implementer-backend', description: 'x', prompt: 'x', isTeammate: true })
  expect(opened).toEqual([false])
  // The person never saw the pane; asking for it must show it.
  await $.command.run({ command: 'agent-panel', args: '' })
  expect(closed).toEqual([])
  expect(opened).toEqual([false, true])
})
