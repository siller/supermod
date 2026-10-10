// The pure glue between the engine's events and the state: options, run-file
// bookkeeping, agent rows and the run snapshot. No `$` here; register.tsx
// calls these from its hooks, refreshes and timers.

import type { PluginOptions } from 'claude-code'
import type { RunFiles, RunState, StoredLedger, StoredPlan, UiOptions } from '../types'
import { recordCompletions } from './eta'
import { computeRun } from './progress'
import type { Ledger, Plan, RunSnapshot } from './progress'
import { upsertAgent } from './usage'
import type { AgentRow, Usage } from './usage'

const FINISHED = new Set(['completed', 'failed', 'killed'])
export const ZERO: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
/** What ends a path inside a tool input: whitespace, quotes, brackets and shell operators. */
const DELIMITERS = /[\s'"`<>()|;&]+/
/** The part every run path holds: workspace, ledger, marker, plan or spec. */
const RUN_PART = /\.superpowers\/sdd\/|docs\/superpowers\/(?:plans|specs)\//
/** Input scanned per field, and the longest run path kept. */
const SCAN_CAP = 100_000
const PATH_CAP = 512
/** Run paths kept from this session's tool calls. */
const REFERENCED_CAP = 100
export const DEFAULT_OPTIONS: UiOptions = { language: 'en', warnPercent: 70, criticalPercent: 85, showCost: true, reviewMinutes: 10 }

export function optionsOf(o: PluginOptions): UiOptions {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    language: o.language === 'de' ? 'de' : 'en',
    warnPercent: num(o.warnPercent, DEFAULT_OPTIONS.warnPercent),
    criticalPercent: num(o.criticalPercent, DEFAULT_OPTIONS.criticalPercent),
    showCost: typeof o.showCost === 'boolean' ? o.showCost : DEFAULT_OPTIONS.showCost,
    reviewMinutes: num(o.reviewMinutes, DEFAULT_OPTIONS.reviewMinutes),
  }
}

export const loadLedger = (s: StoredLedger): Ledger => ({ planPath: s.planPath, tasks: new Map(s.tasks.map(x => [x.n, x])) })
export const loadPlan = (p: StoredPlan): Plan => ({ title: p.title, specPath: p.specPath, taskCount: p.tasks.length, taskTitles: new Map(p.tasks.map(x => [x.n, x.title])) })
export const isFound = (f: RunFiles) => f.ledgerPath !== null || f.planPath !== null || f.specPath !== null || f.workspaceExists
const same = (a: string | null | undefined, b: string | null | undefined) => a != null && a === b
export const sameRun = (a: RunFiles, b: RunFiles) =>
  same(a.planPath, b.planPath) || same(a.specPath, b.specPath) || same(a.ledgerPath, b.ledgerPath) || same(a.workspaceDir, b.workspaceDir)
/** Whether a discovery found another run than the state holds (or the first one). */
export const isNewRun = (c: RunState, found: RunFiles | null) => found !== null && (c.files === null || !sameRun(c.files, found))
export const planKey = (p: string) => (p.includes('docs/superpowers/plans/') ? p.slice(p.lastIndexOf('docs/superpowers/plans/')) : null)

/**
 * Run paths named in a tool call's file path, path, command or prompt: in each
 * token between delimiters that holds a run part, from just after the last `=`
 * before that part to the token's end. Linear in the input: the part is found
 * by plain search, never by a pattern that backtracks over the token; a path
 * longer than 512 characters is dropped.
 */
export function pathsIn(e: Record<string, unknown>): string[] {
  const out = new Set<string>()
  for (const key of ['file_path', 'path', 'command', 'prompt']) {
    const v = e[key]
    if (typeof v !== 'string') continue
    for (const token of v.slice(0, SCAN_CAP).split(DELIMITERS)) {
      if (!token.includes('superpowers/')) continue
      const at = token.search(RUN_PART)
      if (at < 0) continue
      const path = token.slice(token.lastIndexOf('=', at) + 1)
      if (path.length > PATH_CAP) continue
      out.add(path.replace(/^\.\//, '').replace(/[.,:;]+$/, ''))
    }
  }
  return [...out]
}

/** The state with the paths a tool call named moved to the end (the last 100 kept) and the spec it wrote; `c` itself when nothing changes. */
export function withReferenced(c: RunState, paths: string[], spec: string | null): RunState {
  const referenced = [...c.referenced.filter(p => !paths.includes(p)), ...paths].slice(-REFERENCED_CAP)
  const sessionSpec = spec ?? c.sessionSpec
  const isSame = sessionSpec === c.sessionSpec && referenced.length === c.referenced.length && referenced.every((p, i) => p === c.referenced[i])
  return isSame ? c : { ...c, referenced, sessionSpec }
}

export const newRow = (id: string, now: number): AgentRow => ({
  id, type: '', description: '', status: 'running', model: null, startedAt: now, endedAt: null, usage: ZERO, lastWindow: 0, steps: 0,
})

/** Rows with the engine's statuses applied, and rows for agents the mod has not seen spawn. */
export function syncAgents(rows: AgentRow[], listed: readonly { id: string; type: string; description: string; status: string }[], now: number): AgentRow[] {
  let next = rows
  for (const a of listed) {
    const row = next.find(r => r.id === a.id) ?? { ...newRow(a.id, now), type: a.type, description: a.description }
    if (row.status === a.status && next.includes(row)) continue
    const endedAt = FINISHED.has(a.status) ? row.endedAt ?? now : row.endedAt
    next = upsertAgent(next, { ...row, status: a.status, endedAt })
  }
  // The engine drops an agent's entry once its task is over; a row it no longer lists is finished.
  const ids = new Set(listed.map(a => a.id))
  for (const row of next) if (!ids.has(row.id)) next = finishAgent(next, row.id, now)
  return next
}

/** The row closed as `completed` at `now`; the same rows when the id is unknown or the row is finished already. */
export function finishAgent(rows: AgentRow[], id: string, now: number): AgentRow[] {
  const row = rows.find(r => r.id === id)
  if (row === undefined || row.endedAt !== null || FINISHED.has(row.status)) return rows
  return upsertAgent(rows, { ...row, status: 'completed', endedAt: now })
}

/** The run as the band and pane draw it, from the stored files and what this session saw. */
export function snapshotOf(r: RunState): RunSnapshot | null {
  const f = r.files
  if (f === null && r.skillsSeen.length === 0) return null
  return computeRun({
    skillsSeen: new Set(r.skillsSeen),
    specExists: f?.specPath != null,
    planExists: f?.planPath != null,
    ledger: f?.ledger != null ? loadLedger(f.ledger) : null,
    workspaceExists: f?.workspaceExists ?? false,
    files: f?.workspaceFiles ?? [],
    plan: f?.plan != null ? loadPlan(f.plan) : null,
    finishingTurnCompleted: r.finishingTurnCompleted,
    lastLedger: r.lastLedger === null ? null : loadLedger(r.lastLedger),
    ...(f?.specTitle != null ? { specTitle: f.specTitle } : {}),
  })
}

export const withSnapshot = (r: RunState): RunState => ({ ...r, snapshot: snapshotOf(r) })

/**
 * The run state after a discovery (`found` null: nothing found, the last files
 * stay): a new run resets the run's clock, a ledger adds completions. Returns
 * `c` itself when nothing changed, so the caller can skip the write and the
 * band is not drawn again (spec §4.1).
 */
export function applyFiles(c: RunState, found: RunFiles | null, now: number): RunState {
  const files = found ?? c.files
  let next: RunState = { ...c, files }
  if (files !== null) {
    const isNew = isNewRun(c, found)
    if (isNew) next = { ...next, startedAt: now, completions: [], lastLedger: null, startedWithCompleted: false }
    if (files.ledger != null) {
      const done = files.ledger.tasks.filter(x => x.complete).map(x => x.n)
      next = { ...next, lastLedger: files.ledger, completions: recordCompletions(next.completions, done, now) }
      if (isNew) next.startedWithCompleted = done.length > 0
    }
  }
  next = withSnapshot(next)
  return JSON.stringify(next) === JSON.stringify(c) ? c : next
}
