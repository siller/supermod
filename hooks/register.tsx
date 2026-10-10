import type { Register } from 'claude-code'

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'supermod',
      description: 'Show Superpowers progress, context fill and agents',
    })
    return next(e)
  })

  on('command.run', { command: 'supermod' }, async ($, e) => {
    return { text: 'SuperMod: no run detected' }
  })
}
