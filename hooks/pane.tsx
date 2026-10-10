// The detail pane (spec §4.2) and the one-line status (§4.3): a model from the
// state, rows planned against the pane's width, and the tree drawn from that
// plan. Pure: no `$` here; register.tsx reads the state, the clock and the
// surface's elements with its own calls. JSX compiles to the global `h`.

import type { ElementTable, RenderElement } from 'claude-code'
import type { AgentRow, ModelsState, RunSnapshot, UiOptions } from '../types'
import { bandModelOf, clip, planBandRow, styleOf } from './band'
import type { BandState, Segment } from './band'
import { estimateRange, medianMs, taskDurations } from './eta'
import { bar, dur, hm, k, pct, spark, usd } from './format'
import { t } from './i18n'
import type { LabelKey, Lang } from './i18n'
import { slugFromFileName } from './progress'
import { agentContextPercent, estimateUsd, tone } from './usage'
import { isRunActive } from './visibility'

export type PaneState = BandState & { models: ModelsState }

type Tone = 'success' | 'warning' | 'error'

export type PaneAgent = {
  mark: string
  status: string
  type: string
  model: string
  ctxPercent: number | null
  tokensIn: number
  tokensOut: number
  elapsedMs: number
  isFinished: boolean
}

export type PaneModel = {
  lang: Lang
  run: {
    title: string
    path: string | null
    percent: number
    startedAt: number | null
    elapsedMs: number | null
    steps: RunSnapshot['steps']
    current: { n: number; title: string; station: string | null } | null
    eta: { lowMs: number; highMs: number; perTaskMs: number } | null
  } | null
  context: {
    percent: number | null
    tokens: number | null
    window: number | null
    tone: Tone
    warn: number
    critical: number
    spark: string
    compactions: number
    lastCompactionAt: number | null
    breakdown: { name: string; percent: number }[]
  }
  /** Newest first. */
  agents: PaneAgent[]
  running: number
  /** Null when the `showCost` option is off. */
  cost: {
    usd: number
    isEngine: boolean
    models: { name: string; input: number; output: number; cacheRead: number; cacheWrite: number; usd: number }[]
    cacheHit: number | null
  } | null
}

const MINUTE_MS = 60_000
const BREAKDOWN_ROWS = 6
/** Rows the pane keeps for everything but the agent list. */
const NON_AGENT_ROWS = 20
const FINISHED = new Set(['completed', 'failed', 'killed'])
const LIVE = new Set(['running', 'pending'])
const MARKS: Record<string, string> = { running: '●', pending: '○', completed: '✓', failed: '✗', killed: '✗' }
const STEP_MARKS = { done: '✓', active: '▶', pending: '·' } as const
const MODEL_NAMES: Record<string, string> = {
  'claude-opus-5-5': 'Opus 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-haiku-5-5': 'Haiku 5.5',
  'fable': 'Fable',
}
/** Cells of an agent row besides its type: mark, status, model, ctx, tokens, elapsed and the gaps. */
const AGENT_FIXED = 2 + 8 + 1 + 1 + 10 + 1 + 4 + 1 + 8 + 1 + 6
const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** `claude-sonnet-5-5` → `Sonnet 5.5`; an unknown id without its `claude-` prefix. */
export function modelShort(id: string | null): string {
  if (id === null) return '–'
  return MODEL_NAMES[id] ?? id.replace(/^claude-/, '')
}

const statusLabel = (lang: Lang, status: string) =>
  status in MARKS ? t(lang, `agent.${status}` as LabelKey) : status

function agentOf(r: AgentRow, lang: Lang, window: number, now: number): PaneAgent {
  const isFinished = r.endedAt !== null || FINISHED.has(r.status)
  return {
    mark: MARKS[r.status] ?? (isFinished ? '✓' : '·'),
    status: statusLabel(lang, r.status),
    type: r.type || r.description || r.id,
    model: modelShort(r.model),
    ctxPercent: agentContextPercent(r, window, null),
    tokensIn: r.usage.input + r.usage.cacheRead + r.usage.cacheWrite,
    tokensOut: r.usage.output,
    elapsedMs: (r.endedAt ?? now) - r.startedAt,
    isFinished,
  }
}

/** The pane's content from the state; `options` are the mod's, `now` the engine's clock. */
export function paneModel(s: PaneState, o: UiOptions, now: number): PaneModel {
  const lang = o.language
  const last = s.context.ring.at(-1)
  const ctxPercent = last?.percent ?? null
  const bd = s.context.breakdown ?? null
  const context: PaneModel['context'] = {
    percent: ctxPercent,
    tokens: last?.tokens ?? null,
    window: last?.window ?? null,
    tone: tone(ctxPercent, o.warnPercent, o.criticalPercent),
    warn: o.warnPercent,
    critical: o.criticalPercent,
    spark: spark(s.context.ring.map(r => r.percent)),
    compactions: s.context.compactions,
    lastCompactionAt: s.context.lastCompactionAt,
    breakdown: bd === null || bd.maxTokens <= 0
      ? []
      : bd.categories.filter(c => c.kind !== 'deferred').slice(0, BREAKDOWN_ROWS).map(c => ({ name: c.name, percent: Math.round((c.tokens / bd.maxTokens) * 100) })),
  }

  const indexed = s.agents.rows.map((r, i) => ({ r, i }))
  indexed.sort((a, b) => b.r.startedAt - a.r.startedAt || b.i - a.i)
  const agents = indexed.map(({ r }) => agentOf(r, lang, last?.window ?? 0, now))
  const running = s.agents.rows.filter(r => LIVE.has(r.status)).length

  let cost: PaneModel['cost'] = null
  if (o.showCost) {
    const entries = Object.entries(s.models.totals)
    const sum = entries.reduce((a, [, u]) => ({ input: a.input + u.input, output: a.output + u.output, cacheRead: a.cacheRead + u.cacheRead, cacheWrite: a.cacheWrite + u.cacheWrite }), ZERO_USAGE)
    const seen = sum.input + sum.cacheRead + sum.cacheWrite
    cost = {
      usd: s.models.engineUsd ?? estimateUsd(s.models.totals),
      isEngine: s.models.engineUsd !== null,
      models: entries.map(([id, u]) => ({
        name: modelShort(id), input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, usd: estimateUsd({ [id]: u }),
      })),
      cacheHit: seen > 0 ? Math.round((sum.cacheRead / seen) * 100) : null,
    }
  }

  const snap = isRunActive(s.run) ? s.run.snapshot : null
  if (snap === null) return { lang, run: null, context, agents, running, cost }
  const f = s.run.files
  const abs = f?.planPath ?? f?.specPath ?? f?.ledgerPath ?? null
  const path = abs !== null && f?.root && abs.startsWith(f.root + '/') ? abs.slice(f.root.length + 1) : abs
  const since = s.run.startedWithCompleted ? null : s.run.startedAt
  const range = estimateRange(s.run.completions, since, snap.total - snap.completed, o.reviewMinutes)
  const cur = snap.currentTask
  return {
    lang,
    run: {
      title: snap.title || (abs !== null ? slugFromFileName(abs.slice(abs.lastIndexOf('/') + 1)) : t(lang, 'title')),
      path,
      percent: snap.percent,
      startedAt: s.run.startedAt,
      elapsedMs: s.run.startedAt === null ? null : now - s.run.startedAt,
      steps: snap.steps,
      current: cur === null ? null : { n: cur.n, title: cur.title, station: cur.station === 'none' ? null : t(lang, `station.${cur.station}` as LabelKey) },
      eta: range === null ? null : { ...range, perTaskMs: medianMs(taskDurations(s.run.completions, since)) },
    },
    context,
    agents,
    running,
    cost,
  }
}

const minutes = (ms: number) => Math.round(ms / MINUTE_MS)

/** The pane's rows for `columns` cells, the agent list capped to `rows - 20`; no row wider than `columns`. */
export function planPane(m: PaneModel, columns: number, rows: number): Segment[][] {
  const L = (key: LabelKey) => t(m.lang, key)
  const out: Segment[][] = []
  const blank = () => out.push([{ text: ' ' }])
  const barCells = Math.max(4, Math.min(24, columns - 6))

  // 1. Progress overall
  if (m.run === null) {
    out.push([{ text: L('title'), bold: true }, { text: ': ' + L('noRun'), dim: true }])
  } else {
    const r = m.run
    out.push([{ text: r.title, bold: true }])
    if (r.path !== null) out.push([{ text: r.path, dim: true }])
    out.push([{ text: bar(r.percent, barCells) }, { text: ' ' + pct(r.percent), bold: true }])
    if (r.startedAt !== null && r.elapsedMs !== null) {
      out.push([{ text: `${L('started')} ${hm(r.startedAt)} · ${L('elapsed')} ${dur(r.elapsedMs)}`, dim: true }])
    }
    blank()

    // 2. Per step
    for (const step of r.steps) {
      const name = L(`step.${step.id}` as LabelKey)
      const head: Segment = { text: `${STEP_MARKS[step.status]} ${name}`, bold: step.status === 'active', dim: step.status === 'pending' }
      if (step.id === 'tasks' && step.total !== undefined && step.total > 0) {
        const done = step.done ?? 0
        out.push([{ ...head, text: head.text.padEnd(16) }, { text: bar((done / step.total) * 100, 10) }, { text: ` ${done}/${step.total}` }])
        if (r.current !== null) {
          const station = r.current.station === null ? '' : ` · ${r.current.station}`
          out.push([{ text: `    ${L('task')} ${r.current.n}: ${r.current.title}${station}`, dim: true }])
        }
      } else {
        out.push([head])
      }
    }
  }
  blank()

  // 3. Context window
  const c = m.context
  const tokens = c.window === null ? '' : `  ${k(c.tokens)} / ${k(c.window)} ${L('window')}`
  out.push([
    { text: L('context') + ' ', dim: true },
    { text: bar(c.percent, Math.min(12, barCells)), tone: c.tone },
    { text: ' ' + pct(c.percent), tone: c.tone, bold: true },
    { text: tokens, dim: true },
  ])
  out.push([{ text: `${L('threshold')} ${c.warn}% / ${c.critical}%`, dim: true }])
  if (c.spark.length > 0) out.push([{ text: c.spark, tone: c.tone }])
  const compaction = c.lastCompactionAt === null ? L('none') : `${hm(c.lastCompactionAt)} (${c.compactions})`
  out.push([{ text: `${L('lastCompaction')} ${compaction}`, dim: true }])
  const nameCells = Math.max(4, Math.min(22, columns - 6))
  for (const b of c.breakdown) out.push([{ text: `  ${b.name.padEnd(nameCells).slice(0, nameCells)} ${pct(b.percent).padStart(4)}` }])
  blank()

  // 4. Agents, newest first
  out.push([{ text: L('agents'), bold: true }, { text: ` · ${m.running} ${L('agent.running')} · ${L('context')} ${L('approx')}`, dim: true }])
  const cap = Math.max(1, rows - NON_AGENT_ROWS)
  const typeCells = Math.max(4, columns - AGENT_FIXED)
  for (const a of m.agents.slice(0, cap)) {
    const type = a.type.length > typeCells ? a.type.slice(0, typeCells - 1) + '…' : a.type.padEnd(typeCells)
    const text = [
      `${a.mark} ${a.status.padEnd(8).slice(0, 8)} ${type}`,
      a.model.padEnd(10).slice(0, 10),
      pct(a.ctxPercent).padStart(4),
      `${k(a.tokensIn)}/${k(a.tokensOut)}`.padStart(8),
      dur(a.elapsedMs).padStart(6),
    ].join(' ')
    out.push([{ text, dim: a.isFinished }])
  }
  if (m.agents.length > cap) out.push([{ text: L('more').replace('{n}', String(m.agents.length - cap)), dim: true }])

  // 5. Tokens and cost
  if (m.cost !== null) {
    blank()
    const cost = m.cost
    out.push([{ text: `${L('tokens')} · ${L('cost')}`, bold: true }])
    out.push([{ text: (cost.isEngine ? '' : '~') + usd(cost.usd), bold: true }, { text: '  ' + L(cost.isEngine ? 'costEngine' : 'costEstimate'), dim: true }])
    for (const x of cost.models) {
      out.push([{ text: `${x.name.padEnd(11)}${k(x.input)} ${L('in')} · ${k(x.output)} ${L('out')} · ~${usd(x.usd)}` }])
      out.push([{ text: `${''.padEnd(11)}${k(x.cacheRead)} ${L('cacheRead')} · ${k(x.cacheWrite)} ${L('cacheWrite')}`, dim: true }])
    }
    const hit = cost.cacheHit === null ? '' : `${L('cacheHit')} ${pct(cost.cacheHit)} · `
    out.push([{ text: `${hit}~ ${L('costEstimate')}`, dim: true }])
  }

  // 6. Remaining time
  if (m.run !== null) {
    blank()
    const e = m.run.eta
    const value = e === null
      ? L('notEnoughData')
      : `~${minutes(e.lowMs)}–${minutes(e.highMs)} ${L('min')} · ${Math.max(1, minutes(e.perTaskMs))} ${L('min')} ${L('perTask')}`
    out.push([{ text: L('eta') + '  ', dim: true }, { text: value }])
  }

  return out.map(row => clip(row, columns))
}

/** The pane: one Box per planned row, each a run of Texts. */
export function renderPane(els: ElementTable, rows: Segment[][]): RenderElement {
  const { Box, Text } = els
  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        <Box key={`row-${i}`} flexDirection="row">
          {row.map(s => (
            <Text {...styleOf(s)}>{s.text}</Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

/** The band's content as one line of text, prefixed `SuperMod`, whether the band is hidden or not. */
export function statusText(s: BandState, o: UiOptions): string {
  const m = bandModelOf({ ...s, ui: { ...s.ui, isHidden: false, options: o } })
  const L = (key: LabelKey) => t(o.language, key)
  // No run: the status still names the context and the agent count, from the model rather than the row.
  if (m.percent === null) return `${L('title')}: ${L('noRun')}  ${L('ctx')} ${pct(m.ctxPercent)}  ${L('agents')} ${m.agentsRunning}`
  return `${L('title')}  ${planBandRow(m, 10_000).segments.map(x => x.text).join('')}`
}
