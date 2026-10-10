import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { LEDGER_MID_STORED, PLAN_NINE_STORED } from './fixtures'

const MIN = 60_000
const NOW = 1_000 * MIN
const R = '/p/repo'
const PLAN = R + '/docs/superpowers/plans/2026-10-07-englische-ansicht.md'

const RUN = {
  files: {
    root: R, ledgerPath: R + '/.superpowers/sdd/x/progress.md', ledger: LEDGER_MID_STORED, marker: null, planPath: PLAN, plan: PLAN_NINE_STORED,
    specPath: null, specTitle: null, workspaceDir: null, workspaceFiles: [], workspaceExists: true, stamps: [],
  },
  snapshot: {
    title: 'Englische Ansicht Implementation Plan',
    percent: 44,
    steps: [],
    currentTask: { n: 3, title: 'Seite liest Englisch', station: 'fix' },
    completed: 2,
    total: 9,
  },
  skillsSeen: ['superpowers:subagent-driven-development'],
  sessionSpec: null, pinned: null, lastLedger: null, completions: [], startedAt: NOW - 60 * MIN, startedWithCompleted: false,
  finishingTurnCompleted: false, referenced: [],
}
const CONTEXT = { ring: [{ at: NOW, percent: 38, tokens: 380_000, window: 1_000_000 }], compactions: 0, lastCompactionAt: null, lastTone: 'success', breakdown: null }

type Seed = Partial<Record<'run' | 'context', unknown>>
type World = {
  get: (key: string) => any
  opened: unknown[]
  usageArgs: unknown[]
  isPlaced: { value: boolean }
  panes: { value: { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }[] }
  clock: ReturnType<typeof mock.clock>
}

/** Seeded state, the writes the mod made, and stubs for every call the command and the timers make. */
function world(on: On, seed: Seed = {}): World {
  const written: Record<string, unknown> = {}
  const opened: unknown[] = []
  const usageArgs: unknown[] = []
  const isPlaced = { value: true }
  const panes: World['panes'] = { value: [] }
  const clock = mock.clock(on, { now: NOW })
  on('state.get', async ($, e, next) => {
    const r: any = await next(e)
    const v = e.plugin === 'supermod' ? seed[e.key as keyof Seed] : undefined
    return v !== undefined && r?.value?.value === undefined ? ({ value: { value: v, version: 0 } } as any) : r
  })
  on('state.set', async ($, e, next) => {
    const r = await next(e)
    if (e.plugin === 'supermod' && (r as any)?.value?.isSet !== false) written[e.key] = e.value
    return r
  })
  on('session.start', () => ({ cwd: R }))
  on('command.register', () => ({ value: undefined }))
  on('session.root', () => ({ value: R }))
  on('session.surfaces', () => ({ value: ['vscode'] }))
  on('session.usage', ($, e) => {
    usageArgs.push(e)
    const breakdown = (e as { breakdown?: string } | undefined)?.breakdown
      ? {
          categories: [
            { name: 'Messages', tokens: 300_000, color: 'x', isDeferred: false, kind: 'used' },
            { name: 'Free space', tokens: 700_000, color: 'y', isDeferred: false, kind: 'free' },
          ],
          maxTokens: 1_000_000, rawMaxTokens: 1_000_000, totalTokens: 300_000, percentage: 30, gridRows: [], model: 'Opus 5.5',
          memoryFiles: [], mcpTools: [], agents: [], isAutoCompactEnabled: true, apiUsage: null, autocompactSource: 'model',
        }
      : undefined
    return { value: { startedAt: 0, context: { tokens: 380_000, window: 1_000_000, percent: 38, ...(breakdown ? { breakdown } : {}) }, rateLimits: [], cost: { usd: 3.1 } } } as any
  })
  on('agent.list', () => ({ value: [] }))
  on('ui.panes', () => ({ value: panes.value }))
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: isPlaced.value ? { isPlaced: true } : { isPlaced: false, reason: 'no surface places panes' } } as any
  })
  on('fs.read', () => ({ deny: 'missing' }))
  on('fs.list', () => ({ deny: 'missing' }))
  on('fs.stat', () => ({ deny: 'missing' }))
  return { get: key => written[key], opened, usageArgs, isPlaced, panes, clock }
}

const run = ($: any, args: string) => $.command.run({ command: 'supermod', args })

test('/supermod status answers with the band as one line on every surface', async ($, on) => {
  world(on, { run: RUN, context: CONTEXT })
  const answers: string[] = []
  for (const surface of ['vscode', 'terminal', 'desktop']) {
    await $.session.start({ surface, isInteractive: true, cwd: R })
    answers.push((await run($, 'status')).text)
  }
  expect(answers[0]).toMatch(/^SuperMod/)
  expect(answers[0]).not.toContain('\n')
  for (const part of ['englische-ansicht', '44%', 'Task 3/9', 'Fix', '38%']) expect(answers[0]).toContain(part)
  expect(new Set(answers).size).toBe(1)
})

test('/supermod status without a run says no run detected', { options: { language: 'de' } }, async ($, on) => {
  world(on, { context: CONTEXT })
  await $.session.start({ surface: 'vscode', isInteractive: true, cwd: R })
  const text = (await run($, 'status')).text
  expect(text.startsWith('SuperMod: kein Lauf erkannt')).toBe(true)
  expect(text).toContain('38%')
  expect(text).toContain('Agenten 0')
  expect(text).not.toContain('\n')
})

test('/supermod opens the pane and counts it as open', async ($, on) => {
  const w = world(on, { run: RUN, context: CONTEXT })
  const answer = await run($, '')
  expect(answer.text).toBe('SuperMod pane opened')
  expect(w.opened).toEqual([{ id: 'supermod', title: 'SuperMod' }])
  expect(w.get('ui').isPaneOpen).toBe(true)
})

test('/supermod on a surface that places no pane answers with the fallback', async ($, on) => {
  const w = world(on, { run: RUN, context: CONTEXT })
  w.isPlaced.value = false
  expect((await run($, '')).text).toBe('This surface does not draw panes; use /supermod status')
})

test('/supermod use pins a path, use auto unpins', async ($, on) => {
  const w = world(on, { run: RUN, context: CONTEXT })
  const pinned = await run($, 'use /p/repo/docs/superpowers/plans/x.md')
  expect(pinned.text).toBe('Following /p/repo/docs/superpowers/plans/x.md')
  expect(w.get('run').pinned).toBe('/p/repo/docs/superpowers/plans/x.md')
  const relative = await run($, 'use docs/superpowers/plans/y.md')
  expect(relative.text).toBe('Following /p/repo/docs/superpowers/plans/y.md')
  expect(w.get('run').pinned).toBe('/p/repo/docs/superpowers/plans/y.md')
  const auto = await run($, 'use auto')
  expect(auto.text).toBe('Following the newest run')
  expect(w.get('run').pinned).toBeNull()
})

test('the breakdown is asked for only while the pane is open, at most every 30 s', async ($, on) => {
  const w = world(on, { run: RUN, context: CONTEXT })
  const asked = () => w.usageArgs.filter(a => (a as { breakdown?: string } | undefined)?.breakdown === 'summary').length
  const full = () => w.usageArgs.filter(a => (a as { breakdown?: string } | undefined)?.breakdown === 'full').length
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: R })
  await w.clock.advance(9_000)
  expect(asked()).toBe(0)
  w.panes.value = [{ id: 'supermod', title: 'SuperMod', isShown: true, isFocused: false, isPlaced: true }]
  await run($, '')
  await w.clock.advance(3_000)
  expect(asked()).toBe(1)
  expect(w.get('context').breakdown).toMatchObject({ at: NOW + 12_000, maxTokens: 1_000_000, categories: [{ name: 'Messages', tokens: 300_000, kind: 'used' }, { name: 'Free space', tokens: 700_000, kind: 'free' }] })
  await w.clock.advance(27_000)
  expect(asked()).toBe(1)
  await w.clock.advance(3_000)
  expect(asked()).toBe(2)
  expect(full()).toBe(0)
  // Closed again: no more breakdowns, and the stale one is dropped.
  w.panes.value = []
  await w.clock.advance(60_000)
  expect(asked()).toBe(2)
  expect(w.get('context').breakdown).toBeNull()
})
