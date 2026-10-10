import { expect, test } from 'claude-code/testing'
import { isBandVisible, isRunActive } from '../hooks/visibility'
import type { ContextState, RunState } from '../types'

const run = (over: Partial<RunState> = {}): RunState => ({
  files: null, snapshot: null, skillsSeen: [], sessionSpec: null, pinned: null, lastLedger: null,
  completions: [], startedAt: null, startedWithCompleted: false, finishingTurnCompleted: false, referenced: [],
  ...over,
})
const files = {
  root: '/p/repo', ledgerPath: null, ledger: null, marker: null, planPath: '/p/repo/docs/superpowers/plans/x.md', plan: null, specPath: null,
  specTitle: null, workspaceDir: null, workspaceFiles: [], workspaceExists: false, stamps: [],
}
const context = (percent: number | null): ContextState => ({
  ring: percent === null ? [] : [{ at: 0, percent, tokens: null, window: 1_000_000 }], compactions: 0, lastCompactionAt: null, lastTone: 'success', breakdown: null,
})
const OPTS = { warnPercent: 70 }

test('a run is active with a superpowers skill, or a reference and a run found', async () => {
  expect(isRunActive(run())).toBe(false)
  expect(isRunActive(run({ skillsSeen: ['superpowers:brainstorming'] }))).toBe(true)
  expect(isRunActive(run({ referenced: ['docs/superpowers/plans/x.md'] }))).toBe(false)
  expect(isRunActive(run({ files }))).toBe(false)
  expect(isRunActive(run({ files, referenced: ['docs/superpowers/plans/x.md'] }))).toBe(true)
})

test('the band shows for an active run or a high context, never while hidden', async () => {
  const active = run({ skillsSeen: ['superpowers:writing-plans'] })
  expect(isBandVisible({ run: active, context: context(10), ui: { isHidden: false } }, OPTS)).toBe(true)
  expect(isBandVisible({ run: run(), context: context(69), ui: { isHidden: false } }, OPTS)).toBe(false)
  expect(isBandVisible({ run: run(), context: context(70), ui: { isHidden: false } }, OPTS)).toBe(true)
  expect(isBandVisible({ run: run(), context: context(null), ui: { isHidden: false } }, OPTS)).toBe(false)
  expect(isBandVisible({ run: active, context: context(90), ui: { isHidden: true } }, OPTS)).toBe(false)
})
