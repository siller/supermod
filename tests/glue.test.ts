import { expect, test } from 'claude-code/testing'
import { applyFiles, newRow, pathsIn, snapshotOf, syncAgents } from '../hooks/glue'
import type { RunFiles, RunState } from '../types'
import { LEDGER_MID, PLAN_NINE } from './fixtures'

const PLAN = '/p/repo/docs/superpowers/plans/2026-10-07-englische-ansicht.md'
const EMPTY_RUN: RunState = {
  files: null, snapshot: null, skillsSeen: [], sessionSpec: null, pinned: null, lastLedger: null, completions: [],
  startedAt: null, startedWithCompleted: false, finishingTurnCompleted: false, refreshedAt: 0, referenced: [],
}
const FILES: RunFiles = {
  root: '/p/repo', ledgerPath: '/p/repo/.superpowers/sdd/x/progress.md', ledgerText: LEDGER_MID, planPath: PLAN, planText: PLAN_NINE,
  specPath: null, specText: null, workspaceDir: '/p/repo/.superpowers/sdd/x', workspaceFiles: [], workspaceExists: true,
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
  const again = applyFiles(first, FILES, 200)
  expect(again.startedAt).toBe(100)
  expect(again.completions).toEqual(first.completions)
  // Nothing found keeps the last files.
  expect(applyFiles(first, null, 300).files).toBe(FILES)
  const other = applyFiles(first, { ...FILES, ledgerPath: null, ledgerText: null, planPath: '/p/repo/docs/superpowers/plans/other.md' }, 400)
  expect(other.startedAt).toBe(400)
  expect(other.completions).toEqual([])
})
