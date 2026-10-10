import { expect, test } from 'claude-code/testing'
import { discoverRun, discoverWorktreeRoots, isInsideRoots, searchRoots } from '../hooks/scan'
import { fakeFs } from './fakefs'
import type { FakeNode } from './fakefs'
import { LEDGER_MID, LEDGER_OTHER_PLAN, PLAN_NINE } from './fixtures'

const DAY = 86_400_000
const NOW = 30 * DAY
const OPTS = { pinned: null, sessionSpec: null, now: NOW, maxAgeMs: 7 * DAY }

const R = '/p/repo'
const SDD = R + '/.superpowers/sdd'
const PLANS = R + '/docs/superpowers/plans'
const SPECS = R + '/docs/superpowers/specs'
const PLAN = PLANS + '/2026-10-07-englische-ansicht.md'
const SPEC = SPECS + '/2026-10-07-englische-ansicht-design.md'
const WS = SDD + '/2026-10-07-englische-ansicht'
const OLD_WS = SDD + '/2026-09-30-andere-aufgabe'
const OLD_PLAN = PLANS + '/2026-09-30-andere-aufgabe.md'

/** A repository with a current run (newest ledger), an older run, and a sibling project. */
const repoTree = (): Record<string, FakeNode> => ({
  [WS + '/progress.md']: { text: LEDGER_MID, mtimeMs: NOW - DAY },
  [WS + '/plan-path']: 'docs/superpowers/plans/2026-10-07-englische-ansicht.md\n',
  [WS + '/task-3-brief.md']: { text: 'BRIEF', mtimeMs: NOW - 2 * DAY },
  [WS + '/task-2-report.md']: { text: 'REPORT', mtimeMs: NOW - 3 * DAY },
  [WS + '/review-a..b.diff']: { text: 'DIFF', mtimeMs: NOW - 3 * DAY },
  [OLD_WS + '/progress.md']: { text: LEDGER_OTHER_PLAN, mtimeMs: NOW - 2 * DAY },
  [OLD_WS + '/plan-path']: 'docs/superpowers/plans/2026-09-30-andere-aufgabe.md\n',
  [PLAN]: { text: PLAN_NINE, mtimeMs: NOW - 4 * DAY },
  [OLD_PLAN]: { text: '# Andere Aufgabe\n### Task 1: x\n', mtimeMs: NOW - 5 * DAY },
  [SPEC]: { text: '# Englische Ansicht\n', mtimeMs: NOW - 6 * DAY },
  [R + '/.env']: 'SECRET=1',
  '/p/other/.superpowers/sdd/x/progress.md': { text: LEDGER_MID, mtimeMs: NOW },
  '/p/other/.superpowers/sdd/x/plan-path': 'docs/superpowers/plans/x.md',
  '/p/other/docs/superpowers/plans/x.md': { text: PLAN_NINE, mtimeMs: NOW },
})

const readsOf = (fake: { calls: { op: string; path: string }[] }) =>
  fake.calls.filter(c => c.op === 'read').map(c => c.path).sort()

test('searchRoots adds the main checkout for a worktree root', async () => {
  expect(searchRoots('/p/repo/.claude/worktrees/feat')).toEqual(['/p/repo/.claude/worktrees/feat', '/p/repo'])
  expect(searchRoots('/p/repo/.worktrees/feat')).toEqual(['/p/repo/.worktrees/feat', '/p/repo'])
  expect(searchRoots('/p/repo/worktrees/feat/')).toEqual(['/p/repo/worktrees/feat', '/p/repo'])
  expect(searchRoots('/srv/worktrees/repo/.worktrees/feat')).toEqual(['/srv/worktrees/repo/.worktrees/feat', '/srv/worktrees/repo'])
  expect(searchRoots('/p/repo')).toEqual(['/p/repo'])
  expect(searchRoots('/p/repo/.worktrees')).toEqual(['/p/repo/.worktrees'])
})

test('searchRoots never adds the filesystem root', async () => {
  expect(searchRoots('/worktrees/feat')).toEqual(['/worktrees/feat'])
})

test('isInsideRoots accepts the root and paths below it only', async () => {
  expect(isInsideRoots('/p/repo', ['/p/repo'])).toBe(true)
  expect(isInsideRoots('/p/repo/docs/x.md', ['/q', '/p/repo'])).toBe(true)
  expect(isInsideRoots('/p/repo2/docs/x.md', ['/p/repo'])).toBe(false)
  expect(isInsideRoots('/p/repo/../other/x.md', ['/p/repo'])).toBe(false)
  expect(isInsideRoots('/p', ['/p/repo'])).toBe(false)
  expect(isInsideRoots('docs/x.md', ['/p/repo'])).toBe(false)
  expect(isInsideRoots('/etc/passwd', ['/'])).toBe(false)
})

test('discoverRun picks the newest ledger and loads plan, spec and workspace files', async () => {
  const fake = fakeFs(repoTree())
  const run = await discoverRun(fake, [R], OPTS)
  expect(run.root).toBe(R)
  expect(run.ledgerPath).toBe(WS + '/progress.md')
  expect(run.ledgerText).toBe(LEDGER_MID)
  expect(run.planPath).toBe('/p/repo/docs/superpowers/plans/2026-10-07-englische-ansicht.md')
  expect(run.planText).toBe(PLAN_NINE)
  expect(run.specPath).toBe(SPEC)
  expect(run.specText).toBe('# Englische Ansicht\n')
  expect(run.workspaceDir).toBe(WS)
  expect(run.workspaceExists).toBe(true)
  expect(run.workspaceFiles.map(f => f.name)).toContain('task-3-brief.md')
  expect(run.workspaceFiles.find(f => f.name === 'task-3-brief.md')!.mtimeMs).toBe(NOW - 2 * DAY)
  // Brief, report and diff files are listed, never read; nothing else is read either.
  expect(readsOf(fake)).toEqual([PLAN, SPEC, WS + '/plan-path', WS + '/progress.md'].sort())
})

test('discoverRun never touches a sibling project', async () => {
  const fake = fakeFs({
    ...repoTree(),
    [WS + '/plan-path']: '/p/other/docs/superpowers/plans/x.md\n',
    [PLAN]: { text: '# P\n**Spec:** ../other/docs/superpowers/specs/x-design.md\n', mtimeMs: NOW },
  })
  const run = await discoverRun(fake, [R], OPTS)
  expect(run.planPath).toBeNull()
  expect(fake.calls.filter(c => c.path.startsWith('/p/other'))).toEqual([])
  const pinned = await discoverRun(fake, [R], { ...OPTS, pinned: PLAN })
  expect(pinned.planPath).toBe(PLAN)
  expect(pinned.specPath).toBeNull()
  expect(fake.calls.filter(c => c.path.startsWith('/p/other') || !c.path.startsWith(R))).toEqual([])
})

test('a symlinked ledger resolving outside the roots is refused', async () => {
  const fake = fakeFs({
    [WS + '/progress.md']: { text: LEDGER_MID, mtimeMs: NOW, realPath: '/elsewhere/progress.md' },
  })
  const run = await discoverRun(fake, [R], OPTS)
  expect(run.ledgerPath).toBeNull()
  expect(run.ledgerText).toBeNull()
  expect(readsOf(fake)).toEqual([])
})

test('a symlinked workspace or plans folder leaving the roots is never listed', async () => {
  const fake = fakeFs({
    [SDD]: { dir: true, realPath: '/elsewhere/sdd' },
    [PLANS]: { dir: true, realPath: '/elsewhere/plans' },
  })
  const run = await discoverRun(fake, [R], OPTS)
  expect(run.workspaceExists).toBe(false)
  expect(fake.calls.filter(c => c.op === 'list')).toEqual([])
})

test('a plan-path naming a file that is not a plan is refused and never read', async () => {
  for (const marker of ['.env', 'docs/superpowers/specs/2026-10-07-englische-ansicht-design.md', '../repo/.env', '/etc/passwd']) {
    const fake = fakeFs({ ...repoTree(), [WS + '/plan-path']: marker })
    const run = await discoverRun(fake, [R], OPTS)
    expect(run.ledgerPath).toBe(WS + '/progress.md')
    expect(run.planPath).toBeNull()
    expect(readsOf(fake)).toEqual([WS + '/plan-path', WS + '/progress.md'])
  }
})

test('a Spec line naming a file that is not a design spec is refused', async () => {
  const fake = fakeFs({ ...repoTree(), [PLAN]: { text: '# P\n**Spec:** .env\n', mtimeMs: NOW } })
  const run = await discoverRun(fake, [R], OPTS)
  expect(run.planPath).toBe(PLAN)
  expect(run.specPath).toBeNull()
  expect(run.specText).toBeNull()
  expect(fake.calls.filter(c => c.path === R + '/.env')).toEqual([])
})

test('a read failure keeps the ledger null without throwing', async () => {
  const fake = fakeFs({ ...repoTree(), [WS + '/progress.md']: { text: LEDGER_MID, mtimeMs: NOW, fails: ['read'] } })
  const run = await discoverRun(fake, [R], OPTS)
  expect(run.ledgerPath).toBe(WS + '/progress.md')
  expect(run.ledgerText).toBeNull()
  expect(run.planPath).toBe(PLAN)
})

test('stat and list failures resolve to an empty run without throwing', async () => {
  const fake = fakeFs({
    [SDD]: { dir: true, fails: ['list'] },
    [PLANS]: { dir: true, fails: ['stat'] },
  })
  const run = await discoverRun(fake, [R], OPTS)
  expect(run).toEqual({
    root: null, ledgerPath: null, ledgerText: null, planPath: null, planText: null,
    specPath: null, specText: null, workspaceDir: null, workspaceFiles: [], workspaceExists: false,
  })
})

test('a pinned path wins over discovery; session spec is the run before any plan', async () => {
  const fake = fakeFs(repoTree())
  const pinned = await discoverRun(fake, [R], { ...OPTS, pinned: OLD_PLAN })
  expect(pinned.planPath).toBe(OLD_PLAN)
  expect(pinned.workspaceDir).toBe(OLD_WS)
  expect(pinned.ledgerText).toBe(LEDGER_OTHER_PLAN)
  const byLedger = await discoverRun(fake, [R], { ...OPTS, pinned: OLD_WS + '/progress.md' })
  expect(byLedger.planPath).toBe(OLD_PLAN)
  const byDir = await discoverRun(fake, [R], { ...OPTS, pinned: OLD_WS })
  expect(byDir.ledgerPath).toBe(OLD_WS + '/progress.md')

  const noLedgers = fakeFs({
    [PLAN]: { text: PLAN_NINE, mtimeMs: NOW },
    [SPECS + '/2026-10-10-neu-design.md']: { text: '# Neu\n', mtimeMs: NOW },
  })
  const spec = await discoverRun(noLedgers, [R], { ...OPTS, sessionSpec: SPECS + '/2026-10-10-neu-design.md' })
  expect(spec.specPath).toBe(SPECS + '/2026-10-10-neu-design.md')
  expect(spec.specText).toBe('# Neu\n')
  expect(spec.planPath).toBeNull()
  const plan = await discoverRun(noLedgers, [R], OPTS)
  expect(plan.planPath).toBe(PLAN)
  expect(plan.specPath).toBeNull()
  expect(plan.workspaceExists).toBe(false)
})

test('a pinned or session path outside the roots is ignored without touching it', async () => {
  const fake = fakeFs(repoTree())
  const run = await discoverRun(fake, [R], {
    ...OPTS,
    pinned: '/p/other/docs/superpowers/plans/x.md',
    sessionSpec: '/p/other/docs/superpowers/specs/x-design.md',
  })
  expect(run.ledgerPath).toBe(WS + '/progress.md')
  expect(fake.calls.filter(c => c.path.startsWith('/p/other'))).toEqual([])
})

test('ledgers older than maxAgeMs are ignored', async () => {
  const fake = fakeFs({
    [WS + '/progress.md']: { text: LEDGER_MID, mtimeMs: NOW - 8 * DAY },
    [WS + '/plan-path']: 'docs/superpowers/plans/2026-10-07-englische-ansicht.md',
    [PLAN]: { text: PLAN_NINE, mtimeMs: NOW - 9 * DAY },
  })
  const run = await discoverRun(fake, [R], OPTS)
  expect(run.ledgerPath).toBeNull()
  expect(run.planPath).toBeNull()
  expect(readsOf(fake)).toEqual([])
})

test('a run in a worktree root is found and its plan read there', async () => {
  const W = R + '/.worktrees/feat'
  const fake = fakeFs({
    [W + '/.superpowers/sdd/2026-10-07-englische-ansicht/progress.md']: { text: LEDGER_MID, mtimeMs: NOW },
    [W + '/.superpowers/sdd/2026-10-07-englische-ansicht/plan-path']: 'docs/superpowers/plans/2026-10-07-englische-ansicht.md',
    [W + '/docs/superpowers/plans/2026-10-07-englische-ansicht.md']: { text: PLAN_NINE, mtimeMs: NOW },
    [W + '/docs/superpowers/specs/2026-10-07-englische-ansicht-design.md']: '# E\n',
  })
  const run = await discoverRun(fake, [W, R], OPTS)
  expect(run.root).toBe(W)
  expect(run.planPath).toBe(W + '/docs/superpowers/plans/2026-10-07-englische-ansicht.md')
  expect(run.specText).toBe('# E\n')
})

test('a plan over 1 MiB keeps only its headings and the Spec line', async () => {
  const filler = ('x'.repeat(99) + '\n').repeat(11_000)
  const big = '# Big\n\n**Spec:** docs/superpowers/specs/2026-10-07-englische-ansicht-design.md\n' + filler + '### Task 1: A\n```\n## Task 9: not a task\n```\n'
  const fake = fakeFs({ ...repoTree(), [PLAN]: { text: big, mtimeMs: NOW } })
  const run = await discoverRun(fake, [R], OPTS)
  expect(run.planText).toBe('# Big\n**Spec:** docs/superpowers/specs/2026-10-07-englische-ansicht-design.md\n### Task 1: A\n```\n## Task 9: not a task\n```')
  expect(run.specPath).toBe(SPEC)
})

test('discoverWorktreeRoots lists the three worktree folders, names only', async () => {
  const fake = fakeFs({
    [R + '/.claude/worktrees/a']: { dir: true },
    [R + '/.worktrees/b']: { dir: true },
    [R + '/.worktrees/note.txt']: 'x',
    '/p/other/.worktrees/c': { dir: true },
  })
  expect(await discoverWorktreeRoots(fake, R)).toEqual([R + '/.claude/worktrees/a', R + '/.worktrees/b'])
  expect(fake.calls.filter(c => c.op === 'read')).toEqual([])
  expect(fake.calls.filter(c => !c.path.startsWith(R + '/'))).toEqual([])
  const linked = fakeFs({ [R + '/.worktrees']: { dir: true, realPath: '/p/other/.worktrees' }, '/p/other/.worktrees/c': { dir: true } })
  expect(await discoverWorktreeRoots(linked, R)).toEqual([])
  expect(linked.calls.filter(c => c.op === 'list')).toEqual([])
})

test('an empty or unreadable plan-path falls back to the ledger header', async () => {
  for (const marker of ['\n', { text: 'docs/superpowers/plans/x.md', fails: ['read'] as ('read')[] }]) {
    const run = await discoverRun(fakeFs({ ...repoTree(), [WS + '/plan-path']: marker }), [R], OPTS)
    expect(run.planPath).toBe(PLAN)
  }
})

test('a misbehaving Fs never makes discoverRun throw', async () => {
  const odd = {
    read: async () => 42 as unknown as string,
    list: async () => [null, { name: undefined }, { name: '..', kind: 'dir' }, { name: 'w', kind: 'dir', mtimeMs: NOW }] as never,
    stat: (path: string) => {
      if (path.endsWith('plan-path')) throw new Error('sync')
      return Promise.resolve({ kind: path.endsWith('.md') ? 'file' : 'dir', mtimeMs: NOW } as const)
    },
  }
  const run = await discoverRun(odd, [R], OPTS)
  expect(run.ledgerPath).toBe(SDD + '/w/progress.md')
  expect(run.ledgerText).toBeNull()
  expect(await discoverWorktreeRoots(odd, R)).toEqual([R + '/.claude/worktrees/w', R + '/.worktrees/w', R + '/worktrees/w'])
})
