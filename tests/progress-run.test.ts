import { expect, test } from 'claude-code/testing'
import { computeRun, creditOf, parsePlan, stationOf, STEP_WEIGHTS } from '../hooks/progress'
import type { Ledger, RunEvidence, TaskLedger } from '../hooks/progress'
import { PLAN_NINE } from './fixtures'

const plan9 = parsePlan(PLAN_NINE, '2026-10-07-englische-ansicht.md')
const EMPTY_LEDGER: Ledger = { planPath: null, tasks: new Map() }
const ledgerWith = (...tasks: Partial<TaskLedger>[]): Ledger => ({
  planPath: null,
  tasks: new Map(tasks.map(t => [t.n!, { n: t.n!, complete: false, fixRound: null, ...t }])),
})
const ledgerTasks12Complete = ledgerWith({ n: 1, complete: true }, { n: 2, complete: true })
const allNineComplete = ledgerWith(...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ n, complete: true })))
const files3Implementer = [{ name: 'task-3-brief.md', mtimeMs: 10 }]
const EMPTY_EVIDENCE: RunEvidence = {
  skillsSeen: new Set(), specExists: false, planExists: false, ledger: null, workspaceExists: false,
  files: [], plan: null, finishingTurnCompleted: false, lastLedger: null,
}
const evidenceWith = (plan: RunEvidence['plan'], ledger: Ledger, files: RunEvidence['files']): RunEvidence => ({
  ...EMPTY_EVIDENCE, plan, ledger, files, specExists: true, planExists: true, workspaceExists: true,
  skillsSeen: new Set(['superpowers:subagent-driven-development']),
})

test('station from workspace files and ledger', async () => {
  const files = [{ name: 'task-3-brief.md', mtimeMs: 10 }, { name: 'task-3-report.md', mtimeMs: 20 }]
  expect(stationOf(3, EMPTY_LEDGER, [])).toBe('none')
  expect(stationOf(3, EMPTY_LEDGER, [files[0]])).toBe('implementer')
  expect(stationOf(3, EMPTY_LEDGER, files)).toBe('review')
  expect(stationOf(3, ledgerWith({ n: 3, complete: false, fixRound: 1 }), files)).toBe('fix')
  expect(stationOf(3, ledgerWith({ n: 3, complete: true, fixRound: 1 }), files)).toBe('complete')
})

test('an older brief with a newer brief for another task is brief, not implementer', async () => {
  const files = [{ name: 'task-2-brief.md', mtimeMs: 10 }, { name: 'task-3-brief.md', mtimeMs: 20 }]
  expect(stationOf(2, EMPTY_LEDGER, files)).toBe('brief')
  expect(stationOf(3, EMPTY_LEDGER, files)).toBe('implementer')
})

test('credits per station', async () => {
  expect((['none', 'brief', 'implementer', 'review', 'fix', 'complete'] as const).map(creditOf)).toEqual([0, 15, 40, 70, 85, 100])
  expect(Object.values(STEP_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)
})

test('computeRun weights steps and credits the current task', async () => {
  const snap = computeRun({ ...evidenceWith(plan9, ledgerTasks12Complete, files3Implementer) })
  // 5 + 10 + 10 + 60 * (2 + 0.4) / 9 = 41
  expect(snap.percent).toBe(41)
  expect(snap.currentTask).toEqual({ n: 3, title: 'Seite liest Englisch', station: 'implementer' })
  expect(snap.steps.find(s => s.id === 'tasks')).toEqual({ id: 'tasks', status: 'active', done: 2, total: 9 })
  expect(snap.title).toBe('Englische Ansicht Implementation Plan')
  expect([snap.completed, snap.total]).toEqual([2, 9])
})

test('workspace gone after all tasks complete means review done', async () => {
  const snap = computeRun({ ...evidenceWith(plan9, allNineComplete, []), workspaceExists: false, lastLedger: allNineComplete })
  expect(snap.steps.find(s => s.id === 'review')!.status).toBe('done')
  expect(snap.percent).toBe(95)
  expect(snap.currentTask).toBeNull()
})

test('finishing skill seen and turn completed means 100', async () => {
  const snap = computeRun({
    ...evidenceWith(plan9, allNineComplete, []), workspaceExists: false, lastLedger: allNineComplete,
    skillsSeen: new Set(['superpowers:finishing-a-development-branch']), finishingTurnCompleted: true,
  })
  expect(snap.percent).toBe(100)
})

test('brainstorming only shows 2 or 3 percent', async () => {
  const snap = computeRun({ ...EMPTY_EVIDENCE, skillsSeen: new Set(['superpowers:brainstorming']) })
  expect(snap.percent).toBe(3)
})

test('lastLedger carries the run when the workspace is gone and the ledger is null', async () => {
  const snap = computeRun({ ...evidenceWith(plan9, ledgerTasks12Complete, []), ledger: null, workspaceExists: false, lastLedger: ledgerTasks12Complete })
  expect(snap.completed).toBe(2)
  expect(snap.steps.find(s => s.id === 'tasks')!.status).toBe('active')
})

test('all tasks complete with the workspace still present makes review active', async () => {
  const snap = computeRun(evidenceWith(plan9, allNineComplete, []))
  expect(snap.steps.find(s => s.id === 'review')!.status).toBe('active')
  expect(snap.percent).toBe(90)
})

test('writing-plans seen without a ledger makes plan active and earlier steps done', async () => {
  const snap = computeRun({ ...EMPTY_EVIDENCE, specExists: true, skillsSeen: new Set(['superpowers:writing-plans']) })
  expect(snap.steps.map(s => s.status)).toEqual(['done', 'done', 'active', 'pending', 'pending', 'pending'])
  expect(snap.percent).toBe(20)
})
