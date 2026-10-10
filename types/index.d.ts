// The state contract of SuperMod: what the event hooks and timers write and
// the band and pane read. The validator wants it self-contained (no import),
// so the shapes the pure modules define are written out here again; they are
// structurally the same types (hooks/scan.ts, progress.ts, usage.ts, eta.ts,
// i18n.ts), and register.tsx's use of both keeps them in step. Every value is
// JSON data (the host stores it so): a ledger keeps its tasks as a list, not a Map.

export type Lang = 'en' | 'de'

/** hooks/scan.ts `RunFiles`. */
export type RunFiles = {
  root: string | null
  ledgerPath: string | null
  ledgerText: string | null
  planPath: string | null
  planText: string | null
  specPath: string | null
  specText: string | null
  workspaceDir: string | null
  workspaceFiles: { name: string; mtimeMs: number }[]
  workspaceExists: boolean
}

/** hooks/progress.ts `RunSnapshot`. */
export type RunSnapshot = {
  title: string
  percent: number
  steps: {
    id: 'brainstorming' | 'spec' | 'plan' | 'tasks' | 'review' | 'finish'
    status: 'done' | 'active' | 'pending'
    done?: number
    total?: number
  }[]
  currentTask: { n: number; title: string; station: 'none' | 'brief' | 'implementer' | 'review' | 'fix' | 'complete' } | null
  completed: number
  total: number
}

/** hooks/progress.ts `Ledger` as JSON: its `TaskLedger` map as a list. */
export type StoredLedger = { planPath: string | null; tasks: { n: number; complete: boolean; fixRound: number | null }[] }

/** hooks/eta.ts `Completion`. */
export type Completion = { n: number; at: number }

/** hooks/usage.ts `Reading`. */
export type Reading = { at: number; percent: number | null; tokens: number | null; window: number }

/** hooks/usage.ts `Usage`. */
export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** hooks/usage.ts `AgentRow`. */
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

/** hooks/usage.ts `ModelTotals`. */
export type ModelTotals = Record<string, Usage & { steps: number }>

export type RunState = {
  /** The run's files as last found; kept when a refresh finds nothing, null until a run is found. */
  files: RunFiles | null
  /** The run as the band and pane draw it; null when there is no run. */
  snapshot: RunSnapshot | null
  /** `superpowers:*` skills whose prompt was expanded in this session. */
  skillsSeen: string[]
  /** The spec written (Write/Edit) in this session, newest wins. */
  sessionSpec: string | null
  /** The path the person pinned with `/supermod use`, or null to follow the newest run. */
  pinned: string | null
  /** The last ledger read for this run, kept after the workspace is deleted. */
  lastLedger: StoredLedger | null
  /** Task completions in the order they were first seen. */
  completions: Completion[]
  /** When this run was first seen in this session. */
  startedAt: number | null
  /** The run was first seen with tasks already complete (a resume): the ETA ignores startedAt. */
  startedWithCompleted: boolean
  /** A main-loop turn completed after `finishing-a-development-branch` was seen. */
  finishingTurnCompleted: boolean
  refreshedAt: number
  /** Ledger, plan and spec paths named in this session's tool calls. */
  referenced: string[]
}

/** The `/context`-style breakdown (`breakdown: 'summary'`) as the pane draws it: its rows, not its grid. */
export type StoredBreakdown = {
  /** When it was read; the next is asked for no sooner than 30 s later. */
  at: number
  /** The window the rows measure against. */
  maxTokens: number
  categories: { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }[]
}

export type ContextState = {
  /** The last readings of the main context, oldest first. */
  ring: Reading[]
  compactions: number
  lastCompactionAt: number | null
  lastTone: 'success' | 'warning' | 'error'
  /** The last breakdown, kept only while the pane is open; null otherwise. */
  breakdown: StoredBreakdown | null
}

export type AgentsState = { rows: AgentRow[] }

export type ModelsState = {
  totals: ModelTotals
  /** The session's cost as the engine totals it; null where the host keeps none. */
  engineUsd: number | null
}

export type UiOptions = {
  language: Lang
  warnPercent: number
  criticalPercent: number
  showCost: boolean
  reviewMinutes: number
}

export type UiState = {
  isHidden: boolean
  isPaneOpen: boolean
  surfaces: string[]
  options: UiOptions
}

declare module 'claude-code' {
  interface PluginState {
    supermod: {
      run: RunState
      context: ContextState
      agents: AgentsState
      models: ModelsState
      ui: UiState
    }
  }
}
