// The pure glue between the engine's events and the state: options, run-file
// bookkeeping, agent rows and the run snapshot. No `$` here; register.tsx
// calls these from its hooks, refreshes and timers.

import type { PluginOptions } from 'claude-code'
import type { RunState, StoredLedger, UiOptions } from '../types'
import { recordCompletions } from './eta'
import { computeRun, parseLedger, parsePlan, specTitle } from './progress'
import type { Ledger, RunSnapshot } from './progress'
import type { RunFiles } from './scan'
import { upsertAgent } from './usage'
import type { AgentRow, Usage } from './usage'

const FINISHED = new Set(['completed', 'failed', 'killed'])
export const ZERO: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
/** A run path inside a tool input: workspace, ledger, marker, plan or spec. */
const RUN_PATH = /[^\s'"`<>()|;&=]*(?:\.superpowers\/sdd\/|docs\/superpowers\/(?:plans|specs)\/)[^\s'"`<>()|;&]*/g
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

export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)
export const storeLedger = (l: Ledger): StoredLedger => ({ planPath: l.planPath, tasks: [...l.tasks.values()] })
export const loadLedger = (s: StoredLedger): Ledger => ({ planPath: s.planPath, tasks: new Map(s.tasks.map(x => [x.n, x])) })
export const isFound = (f: RunFiles) => f.ledgerPath !== null || f.planPath !== null || f.specPath !== null || f.workspaceExists
export const sameRun = (a: RunFiles, b: RunFiles) =>
  (a.planPath !== null && a.planPath === b.planPath) || (a.specPath !== null && a.specPath === b.specPath) || (a.ledgerPath !== null && a.ledgerPath === b.ledgerPath)
export const planKey = (p: string) => (p.includes('docs/superpowers/plans/') ? p.slice(p.lastIndexOf('docs/superpowers/plans/')) : null)

/** Run paths named in a tool call's file path, path, command or prompt. */
export function pathsIn(e: Record<string, unknown>): string[] {
  const out = new Set<string>()
  for (const key of ['file_path', 'path', 'command', 'prompt']) {
    const v = e[key]
    if (typeof v !== 'string') continue
    for (const m of v.slice(0, 100_000).matchAll(RUN_PATH)) out.add(m[0].replace(/^\.\//, '').replace(/[.,:;]+$/, ''))
  }
  return [...out]
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
  return next
}

/** The run as the band and pane draw it, from the stored files and what this session saw. */
export function snapshotOf(r: RunState): RunSnapshot | null {
  const f = r.files
  if (f === null && r.skillsSeen.length === 0) return null
  return computeRun({
    skillsSeen: new Set(r.skillsSeen),
    specExists: f?.specPath != null,
    planExists: f?.planPath != null,
    ledger: f?.ledgerText != null ? parseLedger(f.ledgerText) : null,
    workspaceExists: f?.workspaceExists ?? false,
    files: f?.workspaceFiles ?? [],
    plan: f?.planText != null && f.planPath !== null ? parsePlan(f.planText, basename(f.planPath)) : null,
    finishingTurnCompleted: r.finishingTurnCompleted,
    lastLedger: r.lastLedger === null ? null : loadLedger(r.lastLedger),
    ...(f?.specText != null && f.specPath !== null ? { specTitle: specTitle(f.specText, basename(f.specPath)) } : {}),
  })
}

export const withSnapshot = (r: RunState): RunState => ({ ...r, snapshot: snapshotOf(r) })

/** The run state after a discovery: new run resets the run's clock, a ledger adds completions. */
export function applyFiles(c: RunState, found: RunFiles | null, now: number): RunState {
  const files = found ?? c.files
  let next: RunState = { ...c, files, refreshedAt: now }
  if (files === null) return withSnapshot(next)
  const isNew = c.files === null || !sameRun(c.files, files)
  if (isNew) next = { ...next, startedAt: now, completions: [], lastLedger: null, startedWithCompleted: false }
  if (files.ledgerText !== null) {
    const ledger = parseLedger(files.ledgerText)
    const done = [...ledger.tasks.values()].filter(x => x.complete).map(x => x.n)
    next = { ...next, lastLedger: storeLedger(ledger), completions: recordCompletions(next.completions, done, now) }
    if (isNew) next.startedWithCompleted = done.length > 0
  }
  return withSnapshot(next)
}
