// SuperMod's hooks: observe the engine's events into `$.state` and keep the
// run and the usage fresh on timers while something is visible (spec §6).
// Parsing and rules live in the pure modules; every `$` call is written out in
// full here, in a hook or in a top-level function that receives `$` (spec §7).
// Every observing hook passes its event on unchanged; only `command.run` for
// `supermod` answers for itself.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, TurnUsage } from 'claude-code'
import type { AgentsState, ContextState, ModelsState, RunState, StoredBreakdown, UiOptions, UiState } from '../types'
import { bandModel, planBandRow, renderBand } from './band'
import { applyFiles, DEFAULT_OPTIONS, isFound, newRow, optionsOf, pathsIn, planKey, syncAgents, withSnapshot, ZERO } from './glue'
import { t } from './i18n'
import { paneModel, planPane, renderPane, statusText } from './pane'
import { discoverRun, discoverWorktreeRoots, resolveRoots } from './scan'
import type { Fs } from './scan'
import { addModel, addUsage, crossing, pushReading, tone, upsertAgent } from './usage'
import type { Reading } from './usage'
import { isBandVisible } from './visibility'

const USAGE_EVERY_MS = 3_000
const FILES_EVERY_MS = 30_000
const BREAKDOWN_EVERY_MS = 30_000
const MAX_AGE_MS = 7 * 86_400_000
const REFERENCED_CAP = 100
const FINISHING = 'superpowers:finishing-a-development-branch'
const SPEC_FILE = /(?:^|\/)docs\/superpowers\/specs\/[^/]+-design\.md$/

const runAtom = atom({ plugin: 'supermod', key: 'run' } as const, {
  files: null, snapshot: null, skillsSeen: [], sessionSpec: null, pinned: null, lastLedger: null, completions: [],
  startedAt: null, startedWithCompleted: false, finishingTurnCompleted: false, refreshedAt: 0, referenced: [],
} as RunState)
const contextAtom = atom({ plugin: 'supermod', key: 'context' } as const, { ring: [], compactions: 0, lastCompactionAt: null, lastTone: 'success', breakdown: null } as ContextState)
const agentsAtom = atom({ plugin: 'supermod', key: 'agents' } as const, { rows: [] } as AgentsState)
const modelsAtom = atom({ plugin: 'supermod', key: 'models' } as const, { totals: {}, engineUsd: null } as ModelsState)
const uiAtom = atom({ plugin: 'supermod', key: 'ui' } as const, { isHidden: false, isPaneOpen: false, surfaces: [], options: DEFAULT_OPTIONS } as UiState)

/** The running timers; a module reload drops them, the state stays. */
let timers: { usage: Timer; files: Timer } | null = null

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

/** The `/context`-style rows while the pane is open, at most every 30 s; dropped once it closes. */
async function refreshBreakdown($: EngineInterface): Promise<void> {
  const isPaneOpen = (await read($, uiAtom)).isPaneOpen
  const cur = (await read($, contextAtom)).breakdown ?? null
  if (!isPaneOpen) {
    if (cur !== null) await update($, contextAtom, c => ({ ...c, breakdown: null }))
    return
  }
  const now = await $.clock.now()
  if (cur !== null && now - cur.at < BREAKDOWN_EVERY_MS) return
  const bd = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  // None without a bound session: an empty one still waits out the 30 s.
  const breakdown: StoredBreakdown = {
    at: now,
    maxTokens: bd?.maxTokens ?? 0,
    categories: (bd?.categories ?? []).map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
  }
  await update($, contextAtom, c => ({ ...c, breakdown }))
}

/** Whether the pane is open, the context (and its breakdown while open), and the engine's agent statuses; a failed part skips no other. */
async function refreshUsage($: EngineInterface, o: UiOptions): Promise<void> {
  await observe(async () => {
    const isPaneOpen = (await $.ui.panes()).some(p => p.id === 'supermod' && p.isShown)
    if ((await read($, uiAtom)).isPaneOpen !== isPaneOpen) await update($, uiAtom, u => ({ ...u, isPaneOpen }))
  })
  await observe(() => refreshContext($, o))
  await observe(() => refreshBreakdown($))
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

  // `/supermod`: no argument opens the pane; hide, show, status, use <path>, use auto.
  on('command.run', { command: 'supermod' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')
    if (verb === 'hide' || verb === 'show') {
      await update($, uiAtom, u => ({ ...u, isHidden: verb === 'hide' }))
      await observe(() => syncTimers($, o))
      return { text: t(o.language, verb === 'hide' ? 'hidden' : 'shown') }
    }
    if (verb === 'status') {
      const state = { run: await read($, runAtom), context: await read($, contextAtom), agents: await read($, agentsAtom), ui: await read($, uiAtom) }
      return { text: statusText(state, o) }
    }
    if (verb === 'use' && arg !== '') {
      const pinned = arg === 'auto' ? null : arg.startsWith('/') ? arg : `${(await $.session.root()).replace(/\/+$/, '')}/${arg.replace(/^\.\//, '')}`
      await update($, runAtom, c => ({ ...c, pinned }))
      await observe(() => refreshRun($))
      await observe(() => syncTimers($, o))
      return { text: pinned === null ? t(o.language, 'unpinned') : t(o.language, 'pinned').replace('{p}', pinned) }
    }
    const opened = await $.ui.open({ id: 'supermod', title: 'SuperMod' })
    await update($, uiAtom, u => ({ ...u, isPaneOpen: true }))
    await observe(() => syncTimers($, o))
    return { text: t(o.language, opened.isPlaced ? 'paneOpened' : 'surfaceFallback') }
  })

  // The pane reads state and the clock only; the command and the timers write.
  on('ui.render', { component: 'Pane', requestId: 'supermod' }, async ($, e) => {
    const state = {
      run: await read($, runAtom), context: await read($, contextAtom), agents: await read($, agentsAtom), models: await read($, modelsAtom), ui: await read($, uiAtom),
    }
    const model = paneModel(state, o, await $.clock.now())
    return renderPane($.ui.resolve(e), planPane(model, e.props.bodyColumns, e.props.scroll.bodyRows))
  })

  // The band reads state only; its buttons write from their own presses.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const state = { run: await read($, runAtom), context: await read($, contextAtom), agents: await read($, agentsAtom), ui: await read($, uiAtom) }
    const model = bandModel(state)
    if (model === null) return next(e)
    return renderBand($.ui.resolve(e), planBandRow(model, e.props.bodyColumns), {
      onDetails: async () => {
        await $.ui.open({ id: 'supermod', title: 'SuperMod' })
        await update($, uiAtom, u => ({ ...u, isPaneOpen: true }))
        await observe(() => syncTimers($, o))
      },
      onHide: async () => {
        await update($, uiAtom, u => ({ ...u, isHidden: true }))
        await observe(() => syncTimers($, o))
      },
    })
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
