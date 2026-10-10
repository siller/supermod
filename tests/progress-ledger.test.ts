import { expect, test } from 'claude-code/testing'
import { parseLedger } from '../hooks/progress'
import { LEDGER_EMPTY, LEDGER_MID, LEDGER_OTHER_PLAN } from './fixtures'

test('parseLedger reads the plan path and task states', async () => {
  const l = parseLedger(LEDGER_MID)
  expect(l.planPath).toBe('docs/superpowers/plans/2026-10-07-englische-ansicht.md')
  expect(l.tasks.get(1)).toEqual({ n: 1, complete: true, fixRound: null })
  expect(l.tasks.get(2)).toEqual({ n: 2, complete: true, fixRound: 1 })
  expect(l.tasks.get(3)).toEqual({ n: 3, complete: false, fixRound: 2 })
})

test('parked, minor and Ruling lines are not stations', async () => {
  const l = parseLedger(LEDGER_MID)
  expect(l.tasks.get(4)).toBeUndefined()
  expect(l.tasks.get(5)).toBeUndefined()
  expect(l.tasks.get(6)).toBeUndefined()
})

test('a header-only ledger has no tasks', async () => {
  const l = parseLedger(LEDGER_EMPTY)
  expect(l.planPath).toBe('docs/superpowers/plans/2026-10-07-englische-ansicht.md')
  expect(l.tasks.size).toBe(0)
})

test('a ledger of another plan names that plan', async () => {
  expect(parseLedger(LEDGER_OTHER_PLAN).planPath).toBe('docs/superpowers/plans/2026-09-30-andere-aufgabe.md')
})

test('an empty text has no plan and no tasks', async () => {
  const l = parseLedger('')
  expect(l.planPath).toBeNull()
  expect(l.tasks.size).toBe(0)
})

test('the header accepts a hyphen and trims trailing spaces', async () => {
  expect(parseLedger('# SDD ledger - plan: docs/p.md   \n').planPath).toBe('docs/p.md')
})

test('a fix round after complete does not un-complete the task', async () => {
  const l = parseLedger('Task 1: complete (x)\nTask 1: fix round 3/5 (y)\n')
  expect(l.tasks.get(1)).toEqual({ n: 1, complete: true, fixRound: 3 })
})
