import type { Register } from 'claude-code'

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-panel',
      description: 'Show or hide the panel of agents with cost, tokens, time and status',
    })
    return next(e)
  })

  on('command.run', { command: 'agent-panel' }, async () => ({ text: 'agent-panel skeleton' }))
}
