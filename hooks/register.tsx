// SuperMod's hooks: observe the engine's events into `$.state` and keep the
// run and the usage fresh on timers while something is visible (spec §6).
// Parsing and rules live in the pure modules; every `$` call is written out in
// full here, in a hook or in a top-level function that receives `$` (spec §7).
// Every observing hook passes its event on unchanged; only `command.run` for
// `supermod` answers for itself.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer, TurnUsage } from 'claude-code'
import type { AgentsState, ContextState, ModelsState, RunState, StoredLedger, UiOptions, UiState } from '../types'
import { recordCompletions } from './eta'
import { t } from './i18n'
import { computeRun, parseLedger, parsePlan, specTitle } from './progress'
import type { Ledger, RunSnapshot } from './progress'
import { discoverRun, discoverWorktreeRoots, resolveRoots } from './scan'
import type { Fs, RunFiles } from './scan'
import { addModel, addUsage, crossing, pushReading, tone, upsertAgent } from './usage'
import type { AgentRow, Reading, Usage } from './usage'
import { isBandVisible } from './visibility'

const USAGE_EVERY_MS = 3_000
const FILES_EVERY_MS = 30_000
const MAX_AGE_MS = 7 * 86_400_000
const REFERENCED_CAP = 100
const FINISHING = 'superpowers:finishing-a-development-branch'
const FINISHED = new Set(['completed', 'failed', 'killed'])
const ZERO: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
/** A run path inside a tool input: workspace, ledger, marker, plan or spec. */
const RUN_PATH = /[^\s'"`<>()|;&=]*(?:\.superpowers\/sdd\/|docs\/superpowers\/(?:plans|specs)\/)[^\s'"`<>()|;&]*/g
const SPEC_FILE = /(?:^|\/)docs\/superpowers\/specs\/[^/]+-design\.md$/
const DEFAULT_OPTIONS: UiOptions = { language: 'en', warnPercent: 70, criticalPercent: 85, showCost: true, reviewMinutes: 10 }

const runAtom = atom({ plugin: 'supermod', key: 'run' } as const, {
  files: null, snapshot: null, skillsSeen: [], sessionSpec: null, pinned: null, lastLedger: null, completions: [],
  startedAt: null, startedWithCompleted: false, finishingTurnCompleted: false, refreshedAt: 0, referenced: [],
} as RunState)
const contextAtom = atom({ plugin: 'supermod', key: 'context' } as const, { ring: [], compactions: 0, lastCompactionAt: null, lastTone: 'success' } as ContextState)
const agentsAtom = atom({ plugin: 'supermod', key: 'agents' } as const, { rows: [] } as AgentsState)
const modelsAtom = atom({ plugin: 'supermod', key: 'models' } as const, { totals: {}, engineUsd: null } as ModelsState)
const uiAtom = atom({ plugin: 'supermod', key: 'ui' } as const, { isHidden: false, isPaneOpen: false, surfaces: [], options: DEFAULT_OPTIONS } as UiState)

/** The running timers; a module reload drops them, the state stays. */
let timers: { usage: Timer; files: Timer } | null = null

// ── Pure helpers ──────────────────────────────────────────────────────────

function optionsOf(o: PluginOptions): UiOptions {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    language: o.language === 'de' ? 'de' : 'en',
    warnPercent: num(o.warnPercent, DEFAULT_OPTIONS.warnPercent),
    criticalPercent: num(o.criticalPercent, DEFAULT_OPTIONS.criticalPercent),
    showCost: typeof o.showCost === 'boolean' ? o.showCost : DEFAULT_OPTIONS.showCost,
    reviewMinutes: num(o.reviewMinutes, DEFAULT_OPTIONS.reviewMinutes),
  }
}

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const storeLedger = (l: Ledger): StoredLedger => ({ planPath: l.planPath, tasks: [...l.tasks.values()] })
const loadLedger = (s: StoredLedger): Ledger => ({ planPath: s.planPath, tasks: new Map(s.tasks.map(x => [x.n, x])) })
const isFound = (f: RunFiles) => f.ledgerPath !== null || f.planPath !== null || f.specPath !== null || f.workspaceExists
const sameRun = (a: RunFiles, b: RunFiles) =>
  (a.planPath !== null && a.planPath === b.planPath) || (a.specPath !== null && a.specPath === b.specPath) || (a.ledgerPath !== null && a.ledgerPath === b.ledgerPath)
const planKey = (p: string) => (p.includes('docs/superpowers/plans/') ? p.slice(p.lastIndexOf('docs/superpowers/plans/')) : null)

/** Run paths named in a tool call's file path, path, command or prompt. */
function pathsIn(e: Record<string, unknown>): string[] {
  const out = new Set<string>()
  for (const key of ['file_path', 'path', 'command', 'prompt']) {
    const v = e[key]
    if (typeof v !== 'string') continue
    for (const m of v.slice(0, 100_000).matchAll(RUN_PATH)) out.add(m[0].replace(/^\.\//, '').replace(/[.,:;]+$/, ''))
  }
  return [...out]
}

const newRow = (id: string, now: number): AgentRow => ({
  id, type: '', description: '', status: 'running', model: null, startedAt: now, endedAt: null, usage: ZERO, lastWindow: 0, steps: 0,
})

/** Rows with the engine's statuses applied, and rows for agents the mod has not seen spawn. */
function syncAgents(rows: AgentRow[], listed: readonly { id: string; type: string; description: string; status: string }[], now: number): AgentRow[] {
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
function snapshotOf(r: RunState): RunSnapshot | null {
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

const withSnapshot = (r: RunState): RunState => ({ ...r, snapshot: snapshotOf(r) })

/** The run state after a discovery: new run resets the run's clock, a ledger adds completions. */
function applyFiles(c: RunState, found: RunFiles | null, now: number): RunState {
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

/** Swallows a failure while observing: the event goes on whatever the mod's bookkeeping did. */
async function observe(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // Observing never breaks the event it observes.
  }
}

// ── Adapters, refreshes and timers (the only places `$` is called) ────────

function fsOf($: EngineInterface): Fs {
  return {
    read: p => $.fs.read(p),
    list: p => $.fs.list(p),
    stat: p => $.fs.stat(p, { resolve: true }).then(s => s, () => null),
  }
}

/** Finds the current run in the search roots and stores files, snapshot and completions. */
async function refreshRun($: EngineInterface): Promise<void> {
  const fs = fsOf($)
  const cur = await read($, runAtom)
  const roots = await resolveRoots(fs, await $.session.root())
  // The worktree folders of the main checkout, whether the session sits in it or in one of its worktrees.
  const main = roots[1] ?? roots[0]
  if (main !== undefined) for (const r of await discoverWorktreeRoots(fs, main)) if (!roots.includes(r)) roots.push(r)
  const now = await $.clock.now()
  const opts = { pinned: cur.pinned, sessionSpec: cur.sessionSpec, now, maxAgeMs: MAX_AGE_MS }
  let found = await discoverRun(fs, roots, opts)
  // The newest-plan route counts only for a plan a tool call named in this session.
  const key = found.planPath === null ? null : planKey(found.planPath)
  if (cur.pinned === null && found.ledgerPath === null && found.planPath !== null && !cur.referenced.some(p => key !== null && planKey(p) === key)) {
    found = { ...found, ledgerPath: null, planPath: null, planText: null, specPath: null, specText: null, workspaceExists: false }
  }
  // Once the workspace is gone, keep following the run's plan rather than falling back to its spec.
  const prev = cur.files
  if (prev?.planPath && found.ledgerPath === null && found.planPath === null && (found.specPath === null || found.specPath === prev.specPath)) {
    const again = await discoverRun(fs, roots, { ...opts, pinned: prev.planPath })
    if (again.planPath === prev.planPath) found = again
  }
  await update($, runAtom, c => applyFiles(c, isFound(found) ? found : null, now))
}

/** Reads the main context; a new reading goes into the ring and may raise one toast. */
async function refreshContext($: EngineInterface, o: UiOptions): Promise<void> {
  const usage = await $.session.usage()
  const now = await $.clock.now()
  const reading: Reading = { at: now, percent: usage.context.percent ?? null, tokens: usage.context.tokens ?? null, window: usage.context.window }
  const engineUsd = usage.cost?.usd ?? null
  const models = await read($, modelsAtom)
  if (models.engineUsd !== engineUsd) await update($, modelsAtom, m => ({ ...m, engineUsd }))
  const last = (await read($, contextAtom)).ring.at(-1)
  if (last && last.percent === reading.percent && last.tokens === reading.tokens && last.window === reading.window) return
  let raised = null as 'warn' | 'critical' | null
  await update($, contextAtom, c => {
    raised = crossing(c.ring.at(-1)?.percent ?? null, reading.percent, o.warnPercent, o.criticalPercent)
    return { ...c, ring: pushReading(c.ring, reading), lastTone: tone(reading.percent, o.warnPercent, o.criticalPercent) }
  })
  if (raised !== null && reading.percent !== null) {
    $.ui.toast(t(o.language, raised === 'warn' ? 'toast.warn' : 'toast.critical').replace('{p}', String(reading.percent)))
  }
}

/** Context, whether the pane is open, and the engine's agent statuses; a failed part skips no other. */
async function refreshUsage($: EngineInterface, o: UiOptions): Promise<void> {
  await observe(() => refreshContext($, o))
  await observe(async () => {
    const isPaneOpen = (await $.ui.panes()).some(p => p.id === 'supermod' && p.isShown)
    if ((await read($, uiAtom)).isPaneOpen !== isPaneOpen) await update($, uiAtom, u => ({ ...u, isPaneOpen }))
  })
  await observe(async () => {
    const listed = await $.agent.list()
    const now = await $.clock.now()
    const rows = (await read($, agentsAtom)).rows
    if (syncAgents(rows, listed, now) !== rows) await update($, agentsAtom, a => ({ rows: syncAgents(a.rows, listed, now) }))
  })
}

/** Usage, run, then the timers, each on its own so one failure skips none of the others. */
async function refreshAll($: EngineInterface, o: UiOptions): Promise<void> {
  await observe(() => refreshUsage($, o))
  await observe(() => refreshRun($))
  await observe(() => syncTimers($, o))
}

/** Adds one model response's usage to its model's totals and, for a subagent, to its row. */
async function recordStep($: EngineInterface, agentId: string | null, u: TurnUsage): Promise<void> {
  await update($, modelsAtom, m => ({ ...m, totals: addModel(m.totals, u.model, addUsage(ZERO, u)) }))
  if (agentId === null) return
  const now = await $.clock.now()
  const lastWindow = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  await update($, agentsAtom, a => {
    const row = a.rows.find(r => r.id === agentId) ?? newRow(agentId, now)
    return { rows: upsertAgent(a.rows, { ...row, model: u.model, usage: addUsage(row.usage, u), lastWindow, steps: row.steps + 1 }) }
  })
}

function startTimers($: EngineInterface, o: UiOptions): void {
  if (timers !== null) return
  timers = {
    usage: $.clock.every(USAGE_EVERY_MS, () => void tick($, o, () => refreshUsage($, o))),
    files: $.clock.every(FILES_EVERY_MS, () => void tick($, o, () => refreshRun($))),
  }
}

function stopTimers(): void {
  timers?.usage.cancel()
  timers?.files.cancel()
  timers = null
}

async function tick($: EngineInterface, o: UiOptions, work: () => Promise<void>): Promise<void> {
  await observe(work)
  await observe(() => syncTimers($, o))
}

/** Timers run only while the band is visible or the pane is open. */
async function syncTimers($: EngineInterface, o: UiOptions): Promise<void> {
  const ui = await read($, uiAtom)
  const visible = isBandVisible({ run: await read($, runAtom), context: await read($, contextAtom), ui }, o)
  if (visible || ui.isPaneOpen) startTimers($, o)
  else stopTimers()
}

// ── Hooks ─────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  const o = optionsOf(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'supermod',
      description: 'Show Superpowers progress, context fill and agents',
    })
    await observe(async () => {
      const surfaces = await $.session.surfaces()
      await update($, uiAtom, u => ({ ...u, surfaces: [...surfaces] }))
    })
    await observe(() => update($, uiAtom, u => ({ ...u, options: o })))
    await refreshAll($, o)
    return next(e)
  })

  on('command.run', { command: 'supermod' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'hide' || arg === 'show') {
      await update($, uiAtom, u => ({ ...u, isHidden: arg === 'hide' }))
      await observe(() => syncTimers($, o))
      return { text: t(o.language, arg === 'hide' ? 'hidden' : 'shown') }
    }
    return { text: 'SuperMod: no run detected' }
  })

  on('skill.prompt', async ($, e, next) => {
    const r = await next(e)
    if (e.skill.startsWith('superpowers:')) {
      await observe(() => update($, runAtom, c => (c.skillsSeen.includes(e.skill) ? c : withSnapshot({ ...c, skillsSeen: [...c.skillsSeen, e.skill] }))))
      await observe(() => syncTimers($, o))
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const paths = pathsIn(input)
    const r = await next(e)
    if (paths.length > 0) {
      const file = input.file_path
      const spec = (e.tool === 'Write' || e.tool === 'Edit') && typeof file === 'string' && SPEC_FILE.test(file) ? file : null
      await observe(() =>
        update($, runAtom, c => ({
          ...c,
          referenced: [...c.referenced.filter(p => !paths.includes(p)), ...paths].slice(-REFERENCED_CAP),
          sessionSpec: spec ?? c.sessionSpec,
        })),
      )
      await observe(() => refreshRun($))
      await observe(() => syncTimers($, o))
    }
    return r
  })

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const usage = r.usage
    if (usage) await observe(() => recordStep($, e.agentId ?? null, usage))
    if (e.agentId === undefined) await observe(() => refreshContext($, o))
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      await observe(() =>
        update($, runAtom, c =>
          c.skillsSeen.includes(FINISHING) && !c.finishingTurnCompleted ? withSnapshot({ ...c, finishingTurnCompleted: true }) : c,
        ),
      )
    }
    await refreshAll($, o)
    return r
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const id = r.agentId
    if (id !== undefined) {
      await observe(async () => {
        const now = await $.clock.now()
        await update($, agentsAtom, a => {
          const row = a.rows.find(x => x.id === id) ?? newRow(id, now)
          return { rows: upsertAgent(a.rows, { ...row, type: e.subagentType, description: e.description, model: row.model ?? r.model }) }
        })
      })
    }
    return r
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    const skipped = 'skip' in r && typeof r.skip === 'string'
    if (e.agentId === undefined && e.trigger !== 'precompute' && !skipped) {
      await observe(async () => {
        const now = await $.clock.now()
        await update($, contextAtom, c => ({ ...c, compactions: c.compactions + 1, lastCompactionAt: now }))
      })
    }
    return r
  })
}
