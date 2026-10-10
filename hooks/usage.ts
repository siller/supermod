import { priceFor } from './prices'

export type Reading = { at: number; percent: number | null; tokens: number | null; window: number }
export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type ApiUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}
export type AgentRow = {
  id: string
  type: string
  description: string
  status: string
  model: string | null
  startedAt: number
  endedAt: number | null
  usage: Usage
  lastWindow: number
  steps: number
}
export type ModelTotals = Record<string, Usage & { steps: number }>

const FINISHED = new Set(['completed', 'failed', 'killed'])
const LARGE_WINDOW = 1_000_000

export function pushReading(ring: Reading[], r: Reading, cap = 30): Reading[] {
  const next = [...ring, r]
  return next.length > cap ? next.slice(next.length - cap) : next
}

export function addUsage(a: Usage, u: ApiUsage): Usage {
  return {
    input: a.input + u.input_tokens,
    output: a.output + u.output_tokens,
    cacheRead: a.cacheRead + u.cache_read_input_tokens,
    cacheWrite: a.cacheWrite + u.cache_creation_input_tokens,
  }
}

export function upsertAgent(rows: AgentRow[], row: AgentRow, cap = 200): AgentRow[] {
  const at = rows.findIndex(r => r.id === row.id)
  if (at >= 0) {
    const next = rows.slice()
    next[at] = row
    return next
  }
  const next = [...rows, row]
  let over = next.length - cap
  if (over <= 0) return next
  const kept = next.filter((r, i) => {
    if (over > 0 && i < next.length - 1 && FINISHED.has(r.status)) {
      over--
      return false
    }
    return true
  })
  return over > 0 ? kept.slice(over) : kept
}

export function agentContextPercent(row: AgentRow, sessionWindow: number, sessionModel: string | null): number | null {
  if (!row.lastWindow) return null
  const window = row.model === null || row.model === sessionModel ? sessionWindow : LARGE_WINDOW
  return Math.min(100, Math.round((row.lastWindow / window) * 100))
}

export function addModel(t: ModelTotals, model: string, u: Usage): ModelTotals {
  const cur = t[model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, steps: 0 }
  return {
    ...t,
    [model]: {
      input: cur.input + u.input,
      output: cur.output + u.output,
      cacheRead: cur.cacheRead + u.cacheRead,
      cacheWrite: cur.cacheWrite + u.cacheWrite,
      steps: cur.steps + 1,
    },
  }
}

export function estimateUsd(t: ModelTotals): number {
  let usd = 0
  for (const [model, u] of Object.entries(t)) {
    const p = priceFor(model)
    usd += (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000
  }
  return Math.round(usd * 100) / 100
}

export function crossing(prev: number | null, next: number | null, warn: number, crit: number): 'warn' | 'critical' | null {
  if (next === null) return null
  const p = prev ?? 0
  if (next >= crit && p < crit) return 'critical'
  if (next >= warn && p < warn) return 'warn'
  return null
}

export function tone(percent: number | null, warn: number, crit: number): 'success' | 'warning' | 'error' {
  if (percent === null || percent < warn) return 'success'
  return percent >= crit ? 'error' : 'warning'
}
