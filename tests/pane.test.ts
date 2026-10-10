import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { paneModel, planPane, statusText } from '../hooks/pane'
import type { PaneState } from '../hooks/pane'
import type { AgentRow, AgentsState, ContextState, ModelsState, RunSnapshot, RunState, UiOptions, UiState } from '../types'

const MIN = 60_000
const NOW = 1_000 * MIN
const T0 = NOW - 60 * MIN
const SURFACES = ['terminal', 'desktop'] as const
const PLAN = '/p/repo/docs/superpowers/plans/2026-10-07-englische-ansicht.md'
const OPTIONS: UiOptions = { language: 'en', warnPercent: 70, criticalPercent: 85, showCost: true, reviewMinutes: 10 }

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

/** A run first seen at T0, three tasks completed 20 minutes apart. */
const RUN: RunState = {
  files: {
    root: '/p/repo', ledgerPath: null, ledger: null, marker: null, planPath: PLAN, plan: null, specPath: null, specTitle: null,
    workspaceDir: null, workspaceFiles: [], workspaceExists: true, stamps: [],
  },
  snapshot: SNAPSHOT,
  skillsSeen: ['superpowers:subagent-driven-development'],
  sessionSpec: null,
  pinned: null,
  lastLedger: null,
  completions: [{ n: 1, at: T0 + 20 * MIN }, { n: 2, at: T0 + 40 * MIN }, { n: 3, at: T0 + 60 * MIN }],
  startedAt: T0,
  startedWithCompleted: false,
  finishingTurnCompleted: false,
  referenced: [],
}
const NO_RUN: RunState = { ...RUN, files: null, snapshot: null, skillsSeen: [], completions: [], startedAt: null }

const CONTEXT: ContextState = {
  ring: [10, 20, 25, 30, 38].map((percent, i) => ({ at: NOW - (4 - i) * MIN, percent, tokens: percent * 10_000, window: 1_000_000 })),
  compactions: 0,
  lastCompactionAt: null,
  lastTone: 'success',
  breakdown: null,
}

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const agent = (id: string, over: Partial<AgentRow>): AgentRow => ({
  id, type: 'general-purpose', description: id, status: 'running', model: null, startedAt: T0, endedAt: null, usage: ZERO, lastWindow: 0, steps: 0, ...over,
})
const AGENTS: AgentsState = {
  rows: [
    agent('a1', { type: 'implementer-integration', model: 'claude-opus-5-5', status: 'completed', startedAt: T0, endedAt: T0 + 10 * MIN, usage: { ...ZERO, input: 50_000, output: 8_000 } }),
    agent('a2', { type: 'implementer-mechanical', model: 'claude-sonnet-5-5', startedAt: NOW - (3 * MIN + 40_000), lastWindow: 210_000, usage: { input: 4_000, output: 12_000, cacheRead: 80_000, cacheWrite: 0 } }),
  ],
}
const MODELS: ModelsState = {
  totals: {
    'claude-opus-5-5': { input: 310_000, output: 12_000, cacheRead: 900_000, cacheWrite: 40_000, steps: 30 },
    'claude-sonnet-5-5': { input: 40_000, output: 20_000, cacheRead: 300_000, cacheWrite: 10_000, steps: 12 },
  },
  engineUsd: 3.1,
}
const UI: UiState = { isHidden: false, isPaneOpen: true, surfaces: ['terminal'], options: OPTIONS }
const FULL: PaneState = { run: RUN, context: CONTEXT, agents: AGENTS, models: MODELS, ui: UI }

const PROPS = { title: 'SuperMod', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }

type Seed = Partial<Record<'run' | 'context' | 'agents' | 'models' | 'ui', unknown>>

/** A store seeded with `seed` where the mod has written nothing yet; the pane writes nothing. */
function world(on: On, seed: Seed): { written: Record<string, unknown> } {
  const written: Record<string, unknown> = {}
  mock.clock(on, { now: NOW })
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
  return { written }
}

const SEED: Seed = { run: RUN, context: CONTEXT, agents: AGENTS, models: MODELS, ui: UI }

const mount = ($: any, surface: string, bodyColumns = 60, bodyRows = 30) =>
  $.ui.mount({
    plugin: 'supermod', component: 'Pane', requestId: 'supermod', surface, viewport: { columns: 100, rows: 40 },
    props: { ...PROPS, bodyColumns, scroll: { offset: 0, bodyRows } },
  })

/** Every row the pane drew, as shown. */
async function rows(ui: any): Promise<string[]> {
  return (await ui.findAll({ type: 'Box' })).filter((b: { key?: string }) => b.key?.startsWith('row-')).map((b: { text: string }) => b.text)
}

test('the pane draws the six sections on every surface', async ($, on) => {
  const w = world(on, SEED)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const shown = await rows(ui)
    const has = (re: RegExp) => shown.some(s => re.test(s))
    // 1. Progress overall: title, path, percent, started and elapsed.
    expect(await ui.find({ type: 'Text', text: /44%/ })).toBeDefined()
    expect(has(/Englische Ansicht Implementation Plan/)).toBe(true)
    expect(has(/docs\/superpowers\/plans\/2026-10-07-englische-ansicht\.md/)).toBe(true)
    expect(has(/Elapsed 1:00:00/)).toBe(true)
    // 2. The six steps with their marks; the current task under Tasks.
    for (const [mark, name] of [['✓', 'Brainstorming'], ['✓', 'Spec'], ['✓', 'Plan'], ['▶', 'Tasks'], ['·', 'Review'], ['·', 'Finish']]) {
      expect(has(new RegExp(`^${mark} ${name}`))).toBe(true)
    }
    expect(has(/2\/9/)).toBe(true)
    expect(has(/Task 5: Sprachumschalter · Implementer/)).toBe(true)
    // 3. Context: toned percent, tokens of window, threshold, sparkline.
    const ctx = await ui.find({ type: 'Text', text: /38%/ })
    expect(ctx?.props.color).toBe('success')
    expect(has(/380k \/ 1M/)).toBe(true)
    expect(has(/Threshold 70% \/ 85%/)).toBe(true)
    expect(has(/▁▂▃▃▄/)).toBe(true)
    expect(has(/Last compaction none/)).toBe(true)
    // 4. Agents, newest first.
    const sonnet = shown.findIndex(s => /Sonnet 5\.5/.test(s))
    const opus = shown.findIndex(s => /implementer-int.*Opus 5\.5/.test(s))
    expect(sonnet).toBeGreaterThan(-1)
    expect(opus).toBeGreaterThan(sonnet)
    expect(shown[sonnet]).toMatch(/^● running/)
    expect(shown[sonnet]).toMatch(/84k\/12k/)
    expect(shown[sonnet]).toMatch(/3:40$/)
    expect(shown[opus]).toMatch(/^✓/)
    // 5. Cost: the engine total as headline, the split as an estimate.
    expect(has(/\$3\.10 +session total from the engine/)).toBe(true)
    expect(has(/estimate at list price/)).toBe(true)
    expect(has(/cache hit/)).toBe(true)
    // 6. Remaining time as a range, with the median per task.
    expect(has(/~105–225 min/)).toBe(true)
    expect(has(/20 min per task/)).toBe(true)
    await ui.unmount()
  }
  // The pane reads state only.
  expect(w.written).toEqual({})
})

test('finished agent rows are dim', async ($, on) => {
  world(on, SEED)
  const ui = await mount($, 'terminal')
  const done = await ui.find({ type: 'Text', text: /implementer-int/ })
  expect(done?.props.color).toBe('subtle')
  const live = await ui.find({ type: 'Text', text: /implementer-mec/ })
  expect(live?.props.color).toBeUndefined()
  await ui.unmount()
})

test('showCost off hides the cost section', { options: { showCost: false } }, async ($, on) => {
  world(on, SEED)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const shown = await rows(ui)
    expect(shown.some(s => /3\.10|estimate at list price|cache hit/.test(s))).toBe(false)
    expect(shown.some(s => /~105–225 min/.test(s))).toBe(true)
    await ui.unmount()
  }
})

test('no pane row is wider than bodyColumns', async ($, on) => {
  world(on, SEED)
  for (const surface of SURFACES) {
    for (const n of [30, 60, 90]) {
      const ui = await mount($, surface, n)
      const shown = await rows(ui)
      expect(shown.length).toBeGreaterThan(20)
      for (const s of shown) expect(s.length).toBeLessThanOrEqual(n)
      await ui.unmount()
    }
  }
  for (const lang of ['en', 'de'] as const) {
    const m = paneModel(FULL, { ...OPTIONS, language: lang }, NOW)
    for (const n of [12, 24, 40, 60, 80, 120]) {
      for (const row of planPane(m, n, 30)) expect(row.reduce((s, x) => s + x.text.length, 0)).toBeLessThanOrEqual(n)
    }
  }
})

test('agent rows are capped to bodyRows - 20 with a +n more row', async ($, on) => {
  const many: AgentsState = { rows: Array.from({ length: 13 }, (_, i) => agent(`a${i}`, { type: `type-${i}`, startedAt: T0 + i * MIN })) }
  world(on, { ...SEED, agents: many })
  const ui = await mount($, 'terminal', 60, 30)
  const shown = await rows(ui)
  const agentRows = shown.filter(s => /type-\d+/.test(s))
  expect(agentRows.length).toBe(10)
  expect(agentRows[0]).toMatch(/type-12/)
  expect(agentRows[9]).toMatch(/type-3/)
  expect(shown.some(s => /^\+3 more/.test(s))).toBe(true)
  await ui.unmount()
})

test('before two completions the remaining time reads not enough data', async ($, on) => {
  world(on, { ...SEED, run: { ...RUN, completions: [{ n: 1, at: T0 + 20 * MIN }] } })
  const ui = await mount($, 'desktop')
  const shown = await rows(ui)
  expect(shown.some(s => /not enough data/.test(s))).toBe(true)
  expect(shown.some(s => /per task/.test(s))).toBe(false)
  await ui.unmount()
})

test('the breakdown shows its categories when the state holds one', async ($, on) => {
  const breakdown = {
    at: NOW, maxTokens: 1_000_000,
    categories: [
      { name: 'System prompt', tokens: 30_000, kind: 'used' },
      { name: 'Messages', tokens: 350_000, kind: 'used' },
      { name: 'MCP tools (deferred)', tokens: 90_000, kind: 'deferred' },
      { name: 'Free space', tokens: 600_000, kind: 'free' },
    ],
  }
  world(on, { ...SEED, context: { ...CONTEXT, compactions: 2, lastCompactionAt: T0, breakdown } })
  const ui = await mount($, 'terminal')
  const shown = await rows(ui)
  expect(shown.some(s => /System prompt +3%/.test(s))).toBe(true)
  expect(shown.some(s => /Messages +35%/.test(s))).toBe(true)
  expect(shown.some(s => /Free space +60%/.test(s))).toBe(true)
  expect(shown.some(s => /deferred/.test(s))).toBe(false)
  expect(shown.some(s => /Last compaction \d\d:\d\d \(2\)/.test(s))).toBe(true)
  await ui.unmount()
})

test('without a run the pane says so and still shows the context', async ($, on) => {
  world(on, { ...SEED, run: NO_RUN })
  const ui = await mount($, 'terminal')
  const shown = await rows(ui)
  expect(shown.some(s => /no run detected/.test(s))).toBe(true)
  expect(shown.some(s => /Brainstorming/.test(s))).toBe(false)
  expect(await ui.find({ type: 'Text', text: /38%/ })).toBeDefined()
  await ui.unmount()
})

test('the engine-less host shows the estimate as headline', async () => {
  const m = paneModel({ ...FULL, models: { ...MODELS, engineUsd: null } }, OPTIONS, NOW)
  const text = planPane(m, 80, 30).map(r => r.map(s => s.text).join(''))
  expect(text.some(s => /^~\$\d+\.\d\d +estimate at list price/.test(s))).toBe(true)
})

test('statusText is the band in one line, prefixed SuperMod', async () => {
  const line = statusText(FULL, OPTIONS)
  expect(line.startsWith('SuperMod')).toBe(true)
  expect(line).not.toContain('\n')
  for (const part of ['englische-ansicht', '44%', 'Task 5/9', 'Implementer', '38%', 'Agents 1', '~105–225 min']) expect(line).toContain(part)
  // Hidden or not, the status answers.
  expect(statusText({ ...FULL, ui: { ...UI, isHidden: true } }, OPTIONS)).toBe(line)
  expect(statusText({ ...FULL, run: NO_RUN }, OPTIONS)).toBe('SuperMod: no run detected')
  expect(statusText({ ...FULL, run: NO_RUN }, { ...OPTIONS, language: 'de' })).toBe('SuperMod: kein Lauf erkannt')
})

test('German agent rows keep a space after the status, the header has no hard-coded label', { options: { language: 'de' } }, async ($, on) => {
  const killed: AgentsState = { rows: [agent('k1', { type: 'implementer-mechanical', status: 'killed', endedAt: NOW })] }
  world(on, { ...SEED, agents: killed })
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const shown = await rows(ui)
    expect(shown.some(s => /^✗ gestoppt implementer/.test(s))).toBe(true)
    const header = shown.find(s => s.startsWith('Agenten'))
    expect(header).toBeDefined()
    expect(header).not.toContain('ctx')
    expect(header).toContain('Kontext ca.')
    for (const s of shown) expect(s.length).toBeLessThanOrEqual(60)
    await ui.unmount()
  }
})
