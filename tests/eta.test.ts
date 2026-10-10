import { expect, test } from 'claude-code/testing'
import { estimateRange, medianMs, recordCompletions } from '../hooks/eta'
import type { Completion } from '../hooks/eta'

const MIN = 60_000
const c = (n: number, at: number): Completion => ({ n, at })

test('recordCompletions adds only new tasks in ascending order and does not mutate', async () => {
  const prev = [c(2, 200)]
  const next = recordCompletions(prev, [3, 1, 2], 500)
  expect(next).toEqual([c(2, 200), c(1, 500), c(3, 500)])
  expect(prev).toEqual([c(2, 200)])
  expect(recordCompletions(next, [1, 2, 3], 900)).toEqual(next)
  expect(recordCompletions([], [], 1)).toEqual([])
})

test('fewer than two completions gives no estimate', async () => {
  expect(estimateRange([], 0, 5, 10)).toBe(null)
  expect(estimateRange([c(1, 10 * MIN)], 0, 5, 10)).toBe(null)
})

test('median duration times open tasks plus review allowance, range 0.7 to 1.5', async () => {
  // durations: 10 min (against run start), 20 min, 30 min -> median 20 min
  const done = [c(1, 10 * MIN), c(2, 30 * MIN), c(3, 60 * MIN)]
  const base = 20 * MIN * 4 + 10 * MIN
  expect(estimateRange(done, 0, 4, 10)).toEqual({ lowMs: Math.round(base * 0.7), highMs: Math.round(base * 1.5) })
})

test('first duration is skipped without a usable run start', async () => {
  const done = [c(1, 10 * MIN), c(2, 30 * MIN), c(3, 40 * MIN)]
  // runStartedAt null: durations 20, 10 -> median 15 min
  expect(estimateRange(done, null, 2, 0)).toEqual({ lowMs: Math.round(30 * MIN * 0.7), highMs: Math.round(30 * MIN * 1.5) })
  // start not before the first completion: skipped too
  expect(estimateRange(done, 10 * MIN, 2, 0)).toEqual(estimateRange(done, null, 2, 0))
})

test('completions are ordered by time before differencing', async () => {
  const done = [c(3, 60 * MIN), c(1, 10 * MIN), c(2, 30 * MIN)]
  expect(estimateRange(done, 0, 1, 0)).toEqual({ lowMs: Math.round(20 * MIN * 0.7), highMs: Math.round(20 * MIN * 1.5) })
})

test('after a resume three tasks at one timestamp give no estimate', async () => {
  const done = recordCompletions([], [1, 2, 3], 5_000_000)
  expect(done.length).toBe(3)
  expect(estimateRange(done, null, 4, 10)).toBe(null)
})

test('zero durations are dropped, the rest still count', async () => {
  const done = [c(1, 10 * MIN), c(2, 10 * MIN), c(3, 30 * MIN)]
  // run start null: durations 0 (dropped), 20 -> median 20 min
  expect(estimateRange(done, null, 1, 0)).toEqual({ lowMs: Math.round(20 * MIN * 0.7), highMs: Math.round(20 * MIN * 1.5) })
})

test('no open tasks leaves the review allowance alone', async () => {
  const done = [c(1, 10 * MIN), c(2, 20 * MIN)]
  expect(estimateRange(done, 0, 0, 10)).toEqual({ lowMs: Math.round(10 * MIN * 0.7), highMs: Math.round(10 * MIN * 1.5) })
})

test('medianMs handles odd, even and empty input', async () => {
  expect(medianMs([])).toBe(0)
  expect(medianMs([5])).toBe(5)
  expect(medianMs([9, 1, 5])).toBe(5)
  expect(medianMs([4, 1, 2, 10])).toBe(3)
})
