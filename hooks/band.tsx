// The band above the prompt (spec §4.1): a model from the state, one row
// planned against the band's width, and the tree drawn from that plan. Pure:
// no `$` here; register.tsx resolves the surface's elements and builds the
// handlers with its own calls. JSX compiles to the global `h`; no name here shadows it.

import type { ElementTable, RenderElement } from 'claude-code'
import type { AgentsState, ContextState, RunState, UiState } from '../types'
import { estimateRange } from './eta'
import { bar, fit, pct } from './format'
import { t } from './i18n'
import type { LabelKey, Lang } from './i18n'
import { slugFromFileName } from './progress'
import { tone } from './usage'
import { isBandVisible, isRunActive } from './visibility'

export type BandModel = {
  title: string | null
  percent: number | null
  task: string | null
  station: string | null
  ctxPercent: number | null
  ctxTone: 'success' | 'warning' | 'error'
  agentsRunning: number
  eta: string | null
  lang: Lang
}
export type BandState = { run: RunState; context: ContextState; agents: AgentsState; ui: UiState }
export type Segment = { text: string; tone?: string; bold?: boolean; dim?: boolean }
/** The planned row; `lang` names the buttons. */
export type BandRow = { segments: Segment[]; lang: Lang }
export type BandHandlers = { onDetails: () => unknown; onHide: () => unknown }

const MINUTE_MS = 60_000
const SEP = '  '
/** The title is truncated down to this many cells before it is dropped. */
const TITLE_MIN = 8
const LIVE = new Set(['running', 'pending'])
/** What goes first when the row is too wide (spec §4.1). */
const DROPS = ['eta', 'agents', 'station', 'title'] as const

type GroupId = 'lead' | 'title' | 'progress' | 'task' | (typeof DROPS)[number] | 'ctx'
/** Segments that stay or go together, `sep` in front of them unless they lead the row. */
type Group = { id: GroupId; sep: string; parts: Segment[] }

/** The band's content, or null when it yields (spec §4.1 visibility). */
export function bandModel(s: BandState): BandModel | null {
  const o = s.ui.options
  if (!isBandVisible(s, o)) return null
  const lang = o.language
  const ctxPercent = s.context.ring.at(-1)?.percent ?? null
  const base = { ctxPercent, ctxTone: tone(ctxPercent, o.warnPercent, o.criticalPercent), lang }
  const agentsRunning = s.agents.rows.filter(r => LIVE.has(r.status)).length
  const snap = isRunActive(s.run) ? s.run.snapshot : null
  if (snap === null) return { ...base, title: null, percent: null, task: null, station: null, agentsRunning, eta: null }
  const plan = s.run.files?.planPath ?? null
  const cur = snap.currentTask
  const range = estimateRange(s.run.completions, s.run.startedWithCompleted ? null : s.run.startedAt, snap.total - snap.completed, o.reviewMinutes)
  return {
    ...base,
    title: plan !== null ? slugFromFileName(plan.slice(plan.lastIndexOf('/') + 1)) : snap.title || null,
    percent: snap.percent,
    task: cur === null ? null : `${t(lang, 'task')} ${cur.n}/${snap.total}`,
    station: cur === null || cur.station === 'none' ? null : t(lang, `station.${cur.station}` as LabelKey),
    agentsRunning,
    eta: range === null ? null : `~${Math.round(range.lowMs / MINUTE_MS)}–${Math.round(range.highMs / MINUTE_MS)} ${t(lang, 'min')}`,
  }
}

/** Cells the two buttons take on the terminal (`[ label ]` each) with a space before each. */
export function buttonCells(lang: Lang): number {
  return 1 + t(lang, 'details').length + 4 + 1 + t(lang, 'hide').length + 4
}

function groupsOf(m: BandModel, isWide: boolean): Group[] {
  const g: Group[] = []
  const label = (key: LabelKey): Segment => ({ text: t(m.lang, key) + ' ', dim: true })
  if (m.title !== null) g.push({ id: 'title', sep: SEP, parts: [{ text: m.title }] })
  else g.push({ id: 'lead', sep: SEP, parts: [{ text: t(m.lang, 'title'), dim: true }] })
  if (m.percent !== null) g.push({ id: 'progress', sep: SEP, parts: [{ text: bar(m.percent, isWide ? 12 : 6) }, { text: ' ' + pct(m.percent), bold: true }] })
  if (m.task !== null) g.push({ id: 'task', sep: SEP, parts: [{ text: m.task }] })
  if (m.task !== null && m.station !== null) g.push({ id: 'station', sep: ' · ', parts: [{ text: m.station, dim: true }] })
  g.push({
    id: 'ctx',
    sep: SEP,
    parts: [label('ctx'), { text: bar(m.ctxPercent, isWide ? 8 : 6), tone: m.ctxTone }, { text: ' ' + pct(m.ctxPercent), tone: m.ctxTone, bold: true }],
  })
  if (m.percent !== null) g.push({ id: 'agents', sep: SEP, parts: [label('agents'), { text: String(m.agentsRunning) }] })
  if (m.eta !== null) g.push({ id: 'eta', sep: SEP, parts: [{ text: m.eta }] })
  return g
}

/** Cells the groups take, the title counted as `titleCells`. */
function widthOf(groups: Group[], titleCells: number): number {
  return groups.reduce((sum, g, i) => {
    const sep = i === 0 ? 0 : g.sep.length
    return sum + sep + (g.id === 'title' ? titleCells : g.parts.reduce((s, p) => s + p.text.length, 0))
  }, 0)
}

const titleOf = (groups: Group[]) => groups.find(g => g.id === 'title')?.parts[0].text ?? ''

/** The row's segments, separators folded into the text, ending before the buttons. */
function flatten(groups: Group[], titleCells: number): Segment[] {
  return groups.flatMap((g, i) => {
    const parts = g.id === 'title' ? [{ ...g.parts[0], text: fit(g.parts[0].text, titleCells) }] : g.parts
    return i === 0 ? parts : [{ ...parts[0], text: g.sep + parts[0].text }, ...parts.slice(1)]
  })
}

/** Cuts the row at `budget` cells, the last segment ending in an ellipsis. */
export function clip(segments: Segment[], budget: number): Segment[] {
  const out: Segment[] = []
  let left = Math.max(0, budget)
  for (const s of segments) {
    if (left === 0) break
    if (s.text.length <= left) {
      out.push(s)
      left -= s.text.length
    } else {
      out.push({ ...s, text: fit(s.text, left) })
      left = 0
    }
  }
  return out
}

/**
 * The band's row for `columns` cells beside the buttons: the full row with
 * 12/8-cell bars, else with 6/6-cell bars, then dropping time range, agents,
 * station, title in that order until it fits; whatever is left is cut.
 */
export function planBandRow(m: BandModel, columns: number): BandRow {
  const budget = columns - buttonCells(m.lang)
  const fits = (gs: Group[]) => widthOf(gs, Math.min(TITLE_MIN, titleOf(gs).length)) <= budget
  const wide = groupsOf(m, true)
  let groups = fits(wide) ? wide : groupsOf(m, false)
  for (const id of DROPS) {
    if (fits(groups)) break
    groups = groups.filter(g => g.id !== id)
  }
  const title = titleOf(groups)
  const titleCells = Math.min(title.length, budget - widthOf(groups, 0))
  return { segments: clip(flatten(groups, titleCells), budget), lang: m.lang }
}

/** A segment's Text props: its tone, `subtle` for a label, bold for a value; no prop left undefined. */
export function styleOf(s: Segment): { color?: string; bold?: boolean } {
  const color = s.tone ?? (s.dim ? 'subtle' : null)
  return { ...(color !== null ? { color } : {}), ...(s.bold ? { bold: true } : {}) }
}

/** The band: one row of the planned segments, then `[Details]` and `[Hide]`. */
export function renderBand(els: ElementTable, row: BandRow, handlers: BandHandlers): RenderElement {
  const { Box, Button, Text } = els
  return (
    <Box flexDirection="row">
      {row.segments.map(s => (
        <Text {...styleOf(s)}>{s.text}</Text>
      ))}
      <Box flexDirection="row" marginLeft={1} gap={1}>
        <Button key="details" label={t(row.lang, 'details')} onPress={handlers.onDetails} />
        <Button key="hide" label={t(row.lang, 'hide')} onPress={handlers.onHide} />
      </Box>
    </Box>
  )
}
