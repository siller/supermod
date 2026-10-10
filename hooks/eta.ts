export type Completion = { n: number; at: number }

const LOW_FACTOR = 0.7
const HIGH_FACTOR = 1.5

export function recordCompletions(prev: Completion[], completedNow: number[], at: number): Completion[] {
  const known = new Set(prev.map(c => c.n))
  const added = [...new Set(completedNow)].filter(n => !known.has(n)).sort((a, b) => a - b)
  return [...prev, ...added.map(n => ({ n, at }))]
}

export function medianMs(durations: number[]): number {
  if (durations.length === 0) return 0
  const s = [...durations].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function estimateRange(
  c: Completion[],
  runStartedAt: number | null,
  openTasks: number,
  reviewMinutes: number,
): { lowMs: number; highMs: number } | null {
  if (c.length < 2) return null
  const sorted = [...c].sort((a, b) => a.at - b.at)
  const durations: number[] = []
  if (typeof runStartedAt === 'number' && runStartedAt < sorted[0].at) durations.push(sorted[0].at - runStartedAt)
  for (let i = 1; i < sorted.length; i++) durations.push(sorted[i].at - sorted[i - 1].at)
  const positive = durations.filter(d => d > 0)
  const median = medianMs(positive)
  if (positive.length === 0 || median <= 0) return null
  const total = median * Math.max(0, openTasks) + reviewMinutes * 60_000
  return { lowMs: Math.round(total * LOW_FACTOR), highMs: Math.round(total * HIGH_FACTOR) }
}
