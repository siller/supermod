import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { bandModel, buttonCells, planBandRow } from '../hooks/band'
import type { BandModel } from '../hooks/band'
import type { AgentRow, AgentsState, ContextState, RunState, RunSnapshot, UiState } from '../types'

const MIN = 60_000
const NOW = 1_000 * MIN
const T0 = NOW - 60 * MIN
const ENGINE = 'drawn by Claude Code'
const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [80, 100, 120] as const
const PLAN = '/p/repo/docs/superpowers/plans/2026-10-07-englische-ansicht.md'

const SNAPSHOT: RunSnapshot = {
  title: 'Englische Ansicht Implementation Plan',
  percent: 44,
  steps: [
    { id: 'brainstorming', status: 'done' },
    { id: 'spec', status: 'done' },
    { id: 'plan', status: 'done' },
    { id: 'tasks', status: 'active', done: 2, total: 9 },
    { id: 'review', status: 'pending' },
    { id: 'finish', status: 'pending' },
  ],
  currentTask: { n: 5, title: 'Sprachumschalter', station: 'implementer' },
  completed: 2,
  total: 9,
}

/** A run first seen at T0 with no task complete; tasks 1 and 2 completed 20 minutes apart. */
const RUN: RunState = {
  files: {
    root: '/p/repo', ledgerPath: null, ledgerText: null, planPath: PLAN, planText: '', specPath: null, specText: null,
    workspaceDir: null, workspaceFiles: [], workspaceExists: true,
  },
  snapshot: SNAPSHOT,
  skillsSeen: ['superpowers:subagent-driven-development'],
  sessionSpec: null,
  pinned: null,
  lastLedger: null,
  completions: [{ n: 1, at: T0 + 20 * MIN }, { n: 2, at: T0 + 40 * MIN }],
  startedAt: T0,
  startedWithCompleted: false,
  finishingTurnCompleted: false,
  refreshedAt: NOW,
  referenced: [],
}
const NO_RUN: RunState = { ...RUN, files: null, snapshot: null, skillsSeen: [], completions: [], startedAt: null }

const context = (percent: number): ContextState => ({
  ring: [{ at: NOW, percent, tokens: percent * 10_000, window: 1_000_000 }], compactions: 0, lastCompactionAt: null, lastTone: 'success',
})
const agent = (id: string, status: string): AgentRow => ({
  id, type: 'general-purpose', description: id, status, model: null, startedAt: T0, endedAt: status === 'completed' ? NOW : null,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, lastWindow: 0, steps: 0,
})
const AGENTS: AgentsState = { rows: [agent('a1', 'running'), agent('a2', 'pending'), agent('a3', 'completed')] }
const UI: UiState = {
  isHidden: false, isPaneOpen: false, surfaces: ['terminal'],
  options: { language: 'en', warnPercent: 70, criticalPercent: 85, showCost: true, reviewMinutes: 10 },
}

const props = (bodyColumns: number, hasSurvey = false) => ({
  hasSurvey, isWorking: false, maxRows: 3, bodyColumns, scroll: { offset: 0, bodyRows: 3 }, view: {},
})

type Seed = Partial<Record<'run' | 'context' | 'agents', unknown>>

type World = { opened: unknown[]; written: Record<string, any>; seed: Seed }

/**
 * The engine's own band beneath the mod, a store seeded with `seed` where the
 * mod has written nothing yet, and the stubs a press needs.
 */
function world(on: On, seed: Seed): World {
  const opened: unknown[] = []
  const written: Record<string, any> = {}
  mock.clock(on, { now: NOW })
  on('ui.render', () => ({ type: 'Text', props: {}, children: [ENGINE] }))
  on('state.get', async ($, e, next) => {
    const r: any = await next(e)
    const v = e.plugin === 'supermod' ? seed[e.key as keyof Seed] : undefined
    return v !== undefined && r?.value?.value === undefined ? ({ value: { value: v, version: 0 } } as any) : r
  })
  on('state.set', async ($, e, next) => {
    const r = await next(e)
    if (e.plugin === 'supermod') written[e.key] = e.value
    return r
  })
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } } as any
  })
  return { opened, written, seed }
}

const mount = ($: any, surface: (typeof SURFACES)[number], columns: number, hasSurvey = false) =>
  $.ui.mount({ plugin: 'supermod', component: 'AbovePrompt', surface, viewport: { columns: columns + 5, rows: 30 }, props: props(columns, hasSurvey) })

/** Every Text the band drew, as shown. */
async function texts(ui: any): Promise<string[]> {
  return (await ui.findAll({ type: 'Text' })).map((x: { text: string }) => x.text)
}

const FULL: BandModel = bandModel({ run: RUN, context: context(38), agents: AGENTS, ui: UI })!
const width = (m: BandModel, n: number) => planBandRow(m, n).segments.reduce((s, x) => s + x.text.length, 0)

test('the band yields when no run and context below warn', async ($, on) => {
  world(on, { run: NO_RUN, context: context(69) })
  for (const surface of SURFACES) {
    const ui = await mount($, surface, 100)
    expect(await ui.find({ text: ENGINE })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'hide' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the band yields to a survey', async ($, on) => {
  world(on, { run: RUN, context: context(38), agents: AGENTS })
  for (const surface of SURFACES) {
    const ui = await mount($, surface, 100, true)
    expect(await ui.find({ text: ENGINE })).toBeDefined()
    await ui.unmount()
  }
})

test('the band shows when a run is active', async ($, on) => {
  world(on, { run: RUN, context: context(38), agents: AGENTS })
  for (const surface of SURFACES) {
    const ui = await mount($, surface, 120)
    expect(await ui.find({ text: ENGINE })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /44%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Task 5\/9/ })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'details' }))?.props.label).toBe('Details')
    expect((await ui.find({ type: 'Button', key: 'hide' }))?.props.label).toBe('Hide')
    await ui.unmount()
  }
})

test('the band shows on context above warn even without a run', async ($, on) => {
  world(on, { run: NO_RUN, context: context(72) })
  for (const surface of SURFACES) {
    const ui = await mount($, surface, 100)
    expect(await ui.find({ text: ENGINE })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /SuperMod/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /72%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Task/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('no band row is wider than bodyColumns', async ($, on) => {
  world(on, { run: RUN, context: context(38), agents: AGENTS })
  for (const surface of SURFACES) {
    for (const n of WIDTHS) {
      const ui = await mount($, surface, n)
      const shown = await texts(ui)
      expect(shown.join('').length + 18).toBeLessThanOrEqual(n)
      expect(shown.join('').length + buttonCells('en')).toBeLessThanOrEqual(n)
      const has = (re: RegExp) => shown.some(s => re.test(s))
      if (n === 80) {
        expect(has(/min/)).toBe(false)
        expect(has(/Agents/)).toBe(false)
      }
      if (n === 120) {
        for (const re of [/englische/, /44%/, /Task 5\/9/, /Implementer/, /38%/, /Agents/, /~105–225 min/]) expect(has(re)).toBe(true)
      }
      await ui.unmount()
    }
  }
})

test('the planned row fits every width in both languages', async () => {
  const de: BandModel = bandModel({ run: RUN, context: context(38), agents: AGENTS, ui: { ...UI, options: { ...UI.options, language: 'de' } } })!
  for (const n of [24, 40, 60, 80, 100, 120, 200]) {
    expect(width(FULL, n) + buttonCells('en')).toBeLessThanOrEqual(Math.max(n, buttonCells('en')))
    expect(width(de, n) + buttonCells('de')).toBeLessThanOrEqual(Math.max(n, buttonCells('de')))
  }
})

test('the row drops time range, agents, station, title in that order', async () => {
  const kinds = (n: number) => {
    const text = planBandRow(FULL, n).segments.map(s => s.text).join('')
    return { eta: text.includes('min'), agents: text.includes('Agents'), station: text.includes('Implementer'), title: text.includes('englisch') }
  }
  expect(kinds(120)).toEqual({ eta: true, agents: true, station: true, title: true })
  expect(kinds(100)).toEqual({ eta: false, agents: true, station: true, title: true })
  expect(kinds(80)).toEqual({ eta: false, agents: false, station: false, title: true })
  expect(kinds(60)).toEqual({ eta: false, agents: false, station: false, title: false })
  // Narrower still, the title-less row is cut with an ellipsis.
  const cut = planBandRow(FULL, 40).segments
  expect(cut.reduce((n, s) => n + s.text.length, 0)).toBe(40 - buttonCells('en'))
  expect(cut.at(-1)?.text.endsWith('…')).toBe(true)
})

const barCells = (n: number) => planBandRow(FULL, n).segments.filter(s => /^ *[█░]+$/.test(s.text)).map(s => s.text.trim().length)

test('the bars shrink before the time range is dropped', async () => {
  // Wide bars where the whole row fits with them.
  expect(barCells(120)).toEqual([12, 8])
  // At 105 the 12/8 row is too wide but the 6/6 row fits: the time range stays.
  const at105 = planBandRow(FULL, 105).segments.map(s => s.text).join('')
  expect(barCells(105)).toEqual([6, 6])
  expect(at105).toContain('~105–225 min')
  expect(at105.length + buttonCells('en')).toBeLessThanOrEqual(105)
  // At 100 even the 6/6 row is too wide: narrow bars and the time range dropped.
  const at100 = planBandRow(FULL, 100).segments.map(s => s.text).join('')
  expect(barCells(100)).toEqual([6, 6])
  expect(at100).not.toContain('min')
  expect(at100).toContain('Agents')
})

test('context tone colours the context segment', async ($, on) => {
  const w = world(on, { run: RUN, agents: AGENTS })
  for (const [percent, color] of [[72, 'warning'], [90, 'error']] as const) {
    w.seed.context = context(percent)
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 120)
      const found = await ui.find({ type: 'Text', text: new RegExp(`${percent}%`) })
      expect(found?.props.color).toBe(color)
      expect(found?.props.bold).toBe(true)
      await ui.unmount()
    }
  }
  const low = planBandRow(FULL, 120).segments.find(s => s.text.includes('38%'))
  expect(low?.tone).toBe('success')
})

test('[Hide] hides, /supermod show shows again', async ($, on) => {
  const w = world(on, { run: RUN, context: context(38), agents: AGENTS })
  for (const surface of SURFACES) {
    const ui = await mount($, surface, 120)
    expect(await ui.find({ type: 'Text', text: /44%/ })).toBeDefined()
    await ui.press({ key: 'hide' })
    expect(w.written.ui.isHidden).toBe(true)
    expect(await ui.find({ text: ENGINE })).toBeDefined()
    await $.command.run({ command: 'supermod', args: 'show' } as any)
    expect(w.written.ui.isHidden).toBe(false)
    expect(await ui.find({ type: 'Text', text: /44%/ })).toBeDefined()
    await ui.unmount()
  }
})

test('[Details] opens the pane and keeps it counted as open', async ($, on) => {
  const w = world(on, { run: RUN, context: context(38), agents: AGENTS })
  const ui = await mount($, 'terminal', 120)
  await ui.press({ key: 'details' })
  expect(w.opened).toEqual([{ id: 'supermod', title: 'SuperMod' }])
  expect(w.written.ui.isPaneOpen).toBe(true)
  await ui.unmount()
})

test('bandModel reads the run, the context and the agents', async () => {
  expect(FULL).toEqual({
    title: 'englische-ansicht', percent: 44, task: 'Task 5/9', station: 'Implementer', ctxPercent: 38, ctxTone: 'success',
    agentsRunning: 2, eta: '~105–225 min', lang: 'en',
  })
  expect(bandModel({ run: NO_RUN, context: context(10), agents: AGENTS, ui: UI })).toBeNull()
  expect(bandModel({ run: RUN, context: context(10), agents: AGENTS, ui: { ...UI, isHidden: true } })).toBeNull()
  const resumed = bandModel({ run: { ...RUN, startedWithCompleted: true, completions: [{ n: 1, at: T0 }, { n: 2, at: T0 }] }, context: context(10), agents: AGENTS, ui: UI })
  expect(resumed?.eta).toBeNull()
  const ctxOnly = bandModel({ run: NO_RUN, context: context(90), agents: AGENTS, ui: UI })
  expect(ctxOnly).toMatchObject({ title: null, percent: null, task: null, station: null, ctxPercent: 90, ctxTone: 'error', eta: null })
})
