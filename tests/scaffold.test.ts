import { expect, test } from 'claude-code/testing'

test('/supermod status answers with text on every surface', async ($, on) => {
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  await $.session.start({ surface: 'vscode', isInteractive: true, cwd: '/work' })
  const answer = await $.command.run({ command: 'supermod', args: 'status' })
  expect(answer.text).toMatch(/^SuperMod/)
})
