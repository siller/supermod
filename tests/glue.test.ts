import { expect, test } from 'claude-code/testing'
import { applyFiles, finishAgent, newRow, reviveAgent, pathsIn, snapshotOf, syncAgents, withReferenced } from '../hooks/glue'
import type { RunFiles, RunState } from '../types'
import { LEDGER_MID_STORED, PLAN_NINE_STORED } from './fixtures'

const PLAN = '/p/repo/docs/superpowers/plans/2026-10-07-englische-ansicht.md'
const EMPTY_RUN: RunState = {
  files: null, snapshot: null, skillsSeen: [], sessionSpec: null, pinned: null, lastLedger: null, completions: [],
  startedAt: null, startedWithCompleted: false, finishingTurnCompleted: false, referenced: [],
}
const FILES: RunFiles = {
  root: '/p/repo', ledgerPath: '/p/repo/.superpowers/sdd/x/progress.md', ledger: LEDGER_MID_STORED, marker: null, planPath: PLAN, plan: PLAN_NINE_STORED,
  specPath: null, specTitle: null, workspaceDir: '/p/repo/.superpowers/sdd/x', workspaceFiles: [], workspaceExists: true, stamps: [],
}

test('pathsIn finds run paths in file paths, commands and prompts, trimmed', async () => {
  expect(pathsIn({ file_path: './docs/superpowers/specs/a-design.md' })).toEqual(['docs/superpowers/specs/a-design.md'])
  expect(pathsIn({ command: 'cat "docs/superpowers/plans/p.md"; ls .superpowers/sdd/x/', prompt: 'see docs/superpowers/plans/p.md.' })).toEqual([
    'docs/superpowers/plans/p.md',
    '.superpowers/sdd/x/',
  ])
  expect(pathsIn({ command: 'git status', other: 'docs/superpowers/plans/p.md', path: 42 })).toEqual([])
})

test('syncAgents applies statuses, adds unseen agents and keeps the rows when nothing changed', async () => {
  const rows = [{ ...newRow('a1', 1), type: 'implementer' }]
  expect(syncAgents(rows, [{ id: 'a1', type: 'implementer', description: '', status: 'running' }], 5)).toBe(rows)
  const next = syncAgents(rows, [
    { id: 'a1', type: 'implementer', description: '', status: 'completed' },
    { id: 'a2', type: 'reviewer', description: 'Review', status: 'running' },
  ], 5)
  expect(next.map(r => [r.id, r.status, r.endedAt, r.startedAt])).toEqual([['a1', 'completed', 5, 1], ['a2', 'running', null, 5]])
  expect(next[1].type).toBe('reviewer')
})

test('syncAgents finishes rows the engine no longer lists and leaves finished rows alone', async () => {
  const rows = [{ ...newRow('a1', 1), type: 'implementer' }, { ...newRow('a2', 2), type: 'reviewer', status: 'killed', endedAt: 3 }]
  const next = syncAgents(rows, [], 9)
  expect(next.map(r => [r.id, r.status, r.endedAt])).toEqual([['a1', 'completed', 9], ['a2', 'killed', 3]])
  // Nothing to change: the same rows come back.
  expect(syncAgents(next, [], 10)).toBe(next)
  expect(syncAgents(rows, [{ id: 'a1', type: 'implementer', description: '', status: 'running' }], 9)).toBe(rows)
})

test('a closed row stays closed while the engine lists its agent as live; a new step revives it', async () => {
  const closed = finishAgent([{ ...newRow('a1', 1), type: 'implementer' }], 'a1', 5)
  expect(syncAgents(closed, [{ id: 'a1', type: 'implementer', description: '', status: 'running' }], 6)).toBe(closed)
  const revived = reviveAgent(closed[0])
  expect([revived.status, revived.endedAt]).toEqual(['running', null])
  expect(reviveAgent(revived)).toBe(revived)
  expect(syncAgents([revived], [], 7).map(r => [r.status, r.endedAt])).toEqual([['completed', 7]])
})

test('syncAgents does not close a row spawned while the list was fetched', async () => {
  const rows = [{ ...newRow('a1', 9), type: 'implementer' }]
  expect(syncAgents(rows, [], 9)).toBe(rows)
})

test('finishAgent closes a live row once and ignores unknown or finished rows', async () => {
  const rows = [{ ...newRow('a1', 1), type: 'implementer' }]
  const done = finishAgent(rows, 'a1', 7)
  expect(done.map(r => [r.id, r.status, r.endedAt])).toEqual([['a1', 'completed', 7]])
  expect(finishAgent(done, 'a1', 8)).toBe(done)
  expect(finishAgent(rows, 'zz', 7)).toBe(rows)
})

test('snapshotOf is null without files or skills and computes the run otherwise', async () => {
  expect(snapshotOf(EMPTY_RUN)).toBeNull()
  expect(snapshotOf({ ...EMPTY_RUN, skillsSeen: ['superpowers:brainstorming'] })?.steps[0].status).toBe('active')
  const snap = snapshotOf({ ...EMPTY_RUN, files: FILES })
  expect(snap?.title).toBe('Englische Ansicht Implementation Plan')
  expect(snap?.completed).toBe(2)
  expect(snap?.total).toBe(9)
})

test('applyFiles resets the clock for a new run and records completions once', async () => {
  const first = applyFiles(EMPTY_RUN, FILES, 100)
  expect(first.startedAt).toBe(100)
  expect(first.startedWithCompleted).toBe(true)
  expect(first.completions).toEqual([{ n: 1, at: 100 }, { n: 2, at: 100 }])
  expect(first.lastLedger).toEqual(LEDGER_MID_STORED)
  // The same run found again, or nothing found (the last files stay), changes nothing: the state itself comes back.
  expect(applyFiles(first, { ...FILES, stamps: [] }, 200)).toBe(first)
  expect(applyFiles(first, null, 300)).toBe(first)
  // A run known only by its workspace is the same run when found again.
  const bare = { ...FILES, ledgerPath: null, ledger: null, planPath: null, plan: null }
  const ws = applyFiles(EMPTY_RUN, bare, 100)
  expect(applyFiles(ws, bare, 500)).toBe(ws)
  const other = applyFiles(first, { ...FILES, ledgerPath: null, ledger: null, workspaceDir: null, planPath: '/p/repo/docs/superpowers/plans/other.md' }, 400)
  expect(other.startedAt).toBe(400)
  expect(other.completions).toEqual([])
})

const elapsedMs = (fn: () => void): number => {
  const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now()
  const t0 = now()
  fn()
  return now() - t0
}

test('pathsIn scans 100k-character inputs without a run path in well under 50 ms', async () => {
  const plain = 'x'.repeat(100_000)
  const nearMiss = 'a'.repeat(99_000) + 'superpowers/plans/' + '.'.repeat(500) + 'z'
  let found: string[] = ['unset']
  const ms = elapsedMs(() => {
    found = pathsIn({ file_path: plain, path: nearMiss, command: plain, prompt: nearMiss })
  })
  expect(found).toEqual([])
  expect(ms).toBeLessThan(50)
})

test('pathsIn keeps a path after `=` and drops one longer than 512 characters', async () => {
  const long = 'docs/superpowers/plans/' + 'p'.repeat(600) + '.md'
  expect(pathsIn({ command: `cat ${long} PLAN=./docs/superpowers/plans/ok.md, x=y` })).toEqual(['docs/superpowers/plans/ok.md'])
})

test('withReferenced moves named paths to the end, keeps the last 100, and changes nothing when nothing is new', async () => {
  const c = { ...EMPTY_RUN, referenced: ['a', 'b'] }
  expect(withReferenced(c, ['b'], null)).toBe(c)
  expect(withReferenced(c, ['a'], null).referenced).toEqual(['b', 'a'])
  expect(withReferenced(c, ['b'], 'docs/superpowers/specs/x-design.md').sessionSpec).toBe('docs/superpowers/specs/x-design.md')
  const many = withReferenced(c, Array.from({ length: 120 }, (_, i) => `p${i}`), null).referenced
  expect(many.length).toBe(100)
  expect(many[99]).toBe('p119')
})
