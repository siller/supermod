import { expect, test } from 'claude-code/testing'
import {
  addModel, addUsage, agentContextPercent, crossing, estimateUsd, pushReading, tone, upsertAgent,
} from '../hooks/usage'
import type { AgentRow, ModelTotals, Reading, Usage } from '../hooks/usage'
import { PRICES_AS_OF, priceFor } from '../hooks/prices'

const ZERO: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const reading = (at: number): Reading => ({ at, percent: at, tokens: at * 10, window: 200_000 })
const agent = (id: string, o: Partial<AgentRow> = {}): AgentRow => ({
  id, type: 'general-purpose', description: id, status: 'running', model: null,
  startedAt: 0, endedAt: null, usage: ZERO, lastWindow: 0, steps: 0, ...o,
})

test('ring keeps the newest 30 readings and does not mutate', async () => {
  let ring: Reading[] = []
  for (let i = 1; i <= 31; i++) ring = pushReading(ring, reading(i))
  expect(ring.length).toBe(30)
  expect(ring[0].at).toBe(2)
  expect(ring[29].at).toBe(31)
  const before: Reading[] = [reading(1)]
  const after = pushReading(before, reading(2))
  expect(before.length).toBe(1)
  expect(after.length).toBe(2)
  expect(pushReading(after, reading(3), 2).map(r => r.at)).toEqual([2, 3])
})

test('addUsage sums the four counters', async () => {
  const sum = addUsage(
    { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
  )
  expect(sum).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44 })
})

test('upsertAgent replaces by id and keeps the order', async () => {
  const rows = upsertAgent(upsertAgent([], agent('a')), agent('b'))
  const next = upsertAgent(rows, agent('a', { status: 'completed', steps: 3 }))
  expect(next.map(r => r.id)).toEqual(['a', 'b'])
  expect(next[0].status).toBe('completed')
  expect(next[0].steps).toBe(3)
  expect(rows[0].status).toBe('running')
})

test('upsertAgent at the cap drops finished rows oldest first', async () => {
  let rows: AgentRow[] = []
  for (let i = 0; i < 200; i++) rows = upsertAgent(rows, agent(`r${i}`, { status: i === 5 || i === 7 ? 'failed' : 'running' }))
  expect(rows.length).toBe(200)
  rows = upsertAgent(rows, agent('new'))
  expect(rows.length).toBe(200)
  expect(rows.some(r => r.id === 'r5')).toBe(false)
  expect(rows.some(r => r.id === 'r7')).toBe(true)
  expect(rows[rows.length - 1].id).toBe('new')
  rows = upsertAgent(rows, agent('newer'))
  expect(rows.some(r => r.id === 'r7')).toBe(false)
  expect(rows.length).toBe(200)
})

test('upsertAgent drops the oldest row when none is finished', async () => {
  let rows: AgentRow[] = []
  for (let i = 0; i < 200; i++) rows = upsertAgent(rows, agent(`r${i}`))
  rows = upsertAgent(rows, agent('new'))
  expect(rows.length).toBe(200)
  expect(rows[0].id).toBe('r1')
  expect(rows[199].id).toBe('new')
  const again = upsertAgent(rows, agent('r1', { status: 'idle' }))
  expect(again.length).toBe(200)
  expect(again[0].status).toBe('idle')
})

test('agentContextPercent picks the window by model', async () => {
  const row = agent('a', { model: 'claude-sonnet-5-5', lastWindow: 100_000 })
  expect(agentContextPercent(row, 200_000, 'claude-sonnet-5-5')).toBe(50)
  expect(agentContextPercent(row, 200_000, 'claude-opus-5-5')).toBe(10)
  expect(agentContextPercent({ ...row, model: null }, 200_000, 'claude-opus-5-5')).toBe(50)
  expect(agentContextPercent({ ...row, lastWindow: 0 }, 200_000, 'claude-sonnet-5-5')).toBe(null)
  expect(agentContextPercent({ ...row, lastWindow: 500_000 }, 200_000, 'claude-sonnet-5-5')).toBe(100)
  expect(agentContextPercent({ ...row, lastWindow: 33_333 }, 200_000, 'claude-sonnet-5-5')).toBe(17)
})

test('addModel accumulates per model and counts steps', async () => {
  const u: Usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }
  const a = addModel({}, 'claude-sonnet-5-5', u)
  const b = addModel(a, 'claude-sonnet-5-5', u)
  const c = addModel(b, 'claude-opus-5-5', u)
  expect(a['claude-sonnet-5-5']).toEqual({ ...u, steps: 1 })
  expect(b['claude-sonnet-5-5']).toEqual({ input: 2, output: 4, cacheRead: 6, cacheWrite: 8, steps: 2 })
  expect(c['claude-opus-5-5'].steps).toBe(1)
  expect(Object.keys(c).length).toBe(2)
  expect(Object.keys(a).length).toBe(1)
})

test('prices match by regex in order', async () => {
  expect(PRICES_AS_OF).toBe('2026-10-10')
  expect(priceFor('claude-opus-5-5')).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 })
  expect(priceFor('claude-sonnet-5-5')).toEqual({ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 })
  expect(priceFor('claude-haiku-5-5')).toEqual({ input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 })
  expect(priceFor('claude-fable-5')).toEqual({ input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 })
  expect(priceFor('mythos-1')).toEqual({ input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 })
  expect(priceFor('claude-opus-4-1')).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 })
  expect(priceFor('claude-sonnet-4')).toEqual({ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 })
  expect(priceFor('claude-haiku-3')).toEqual({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 })
  expect(priceFor('something-else')).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 })
  expect(priceFor('')).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 })
})

test('estimateUsd sums models and rounds to cents', async () => {
  const one: ModelTotals = { 'claude-sonnet-5-5': { ...ZERO, input: 1_000_000, steps: 1 } }
  expect(estimateUsd(one)).toBe(2)
  expect(estimateUsd({})).toBe(0)
  const mixed: ModelTotals = {
    'claude-sonnet-5-5': { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0, steps: 2 },
    'claude-opus-5-5': { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000, steps: 1 },
  }
  expect(estimateUsd(mixed)).toBe(8.2)
  expect(estimateUsd({ 'claude-sonnet-5-5': { ...ZERO, input: 1234, steps: 1 } })).toBe(0)
  expect(estimateUsd({ 'claude-sonnet-5-5': { ...ZERO, input: 3_000_000, output: 1, steps: 1 } })).toBe(6)
})

test('crossing fires on upward crossings only', async () => {
  expect(crossing(60, 72, 70, 85)).toBe('warn')
  expect(crossing(60, 90, 70, 85)).toBe('critical')
  expect(crossing(72, 74, 70, 85)).toBe(null)
  expect(crossing(90, 65, 70, 85)).toBe(null)
  expect(crossing(65, 71, 70, 85)).toBe('warn')
  expect(crossing(72, 90, 70, 85)).toBe('critical')
  expect(crossing(90, 92, 70, 85)).toBe(null)
  expect(crossing(90, 75, 70, 85)).toBe(null)
  expect(crossing(60, null, 70, 85)).toBe(null)
  expect(crossing(null, 75, 70, 85)).toBe('warn')
  expect(crossing(null, 50, 70, 85)).toBe(null)
  expect(crossing(69, 70, 70, 85)).toBe('warn')
})

test('tone by threshold', async () => {
  expect(tone(null, 70, 85)).toBe('success')
  expect(tone(69, 70, 85)).toBe('success')
  expect(tone(70, 70, 85)).toBe('warning')
  expect(tone(84, 70, 85)).toBe('warning')
  expect(tone(85, 70, 85)).toBe('error')
})
