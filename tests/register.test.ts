import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { fakeFs } from './fakefs'
import type { FakeNode } from './fakefs'
import { LEDGER_MID, PLAN_NINE } from './fixtures'

const DAY = 86_400_000
const NOW = 30 * DAY
const R = '/p/repo'
const MESSAGES = [{ role: 'user' as const, text: 'summary', toolUses: [] }]
const PLAN = R + '/docs/superpowers/plans/2026-10-07-englische-ansicht.md'
const SPEC = R + '/docs/superpowers/specs/2026-10-07-englische-ansicht-design.md'
const WS = R + '/.superpowers/sdd/2026-10-07-englische-ansicht'


/** A repository with a run in progress: fresh ledger, plan and spec. */
const runTree = (): Record<string, FakeNode> => ({
  [R + '/.git']: { dir: true },
  [WS + '/progress.md']: { text: LEDGER_MID, mtimeMs: NOW - DAY },
  [WS + '/plan-path']: 'docs/superpowers/plans/2026-10-07-englische-ansicht.md\n',
  [WS + '/task-3-brief.md']: { text: 'BRIEF', mtimeMs: NOW - 2 * DAY },
  [PLAN]: { text: PLAN_NINE, mtimeMs: NOW - 4 * DAY },
  [SPEC]: { text: '# Englische Ansicht\n', mtimeMs: NOW - 6 * DAY },
})

/** A plan and its spec, no workspace: only a reference in this session makes it the run. */
const planOnlyTree = (): Record<string, FakeNode> => ({
  [R + '/.git']: { dir: true },
  [PLAN]: { text: PLAN_NINE, mtimeMs: NOW - DAY },
  [SPEC]: { text: '# Englische Ansicht\n', mtimeMs: NOW - 2 * DAY },
})

type Key = 'run' | 'context' | 'agents' | 'models' | 'ui'

type World = {
  /** The last value the mod wrote under `key` (the test's `$` has no `state` noun; a hook beneath the mod sees each write). */
  get: (key: Key) => any
  toasts: string[]
  commands: string[]
  lists: () => number
  /** Files read through `fs.read`, in order. */
  reads: string[]
  /** How many times the mod wrote `key`. */
  writes: (key: Key) => number
  /** How long, on the mocked clock, each `fs.read` takes to answer. */
  readDelayMs: { value: number }
  /** The context percent the next `session.usage` answers. */
  percent: { value: number }
  /** When true, `session.usage` is refused. */
  denyUsage: { value: boolean }
  clock: ReturnType<typeof mock.clock>
}

/** Every stub the mod's calls need; register before the first call on `$`. */
function world(on: On, tree: Record<string, FakeNode> = runTree()): World {
  const fake = fakeFs(tree)
  const toasts: string[] = []
  const commands: string[] = []
  const percent = { value: 38 }
  const denyUsage = { value: false }
  let lists = 0
  const reads: string[] = []
  const readDelayMs = { value: 0 }
  const clock = mock.clock(on, { now: NOW })
  const written: Partial<Record<Key, unknown>> = {}
  const writeCounts: Partial<Record<Key, number>> = {}
  on('state.set', async ($, e, next) => {
    const r = await next(e)
    if (e.plugin === 'supermod' && (r as any)?.value?.isSet !== false) {
      written[e.key as Key] = e.value
      writeCounts[e.key as Key] = (writeCounts[e.key as Key] ?? 0) + 1
    }
    return r
  })
  on('session.start', () => ({ cwd: R }))
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: undefined }
  })
  on('session.root', () => ({ value: R }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.usage', () => denyUsage.value ? { deny: 'no usage' } : ({
    value: {
      startedAt: 0,
      context: { tokens: percent.value * 10_000, window: 1_000_000, percent: percent.value },
      rateLimits: [],
      cost: { usd: 3.1 },
    },
  }))
  on('agent.list', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.read', async ($, e) => {
    reads.push(e.path)
    if (readDelayMs.value > 0) await clock.sleep(readDelayMs.value)
    try {
      return { value: await fake.read(e.path) }
    } catch {
      return { deny: 'missing' }
    }
  })
  on('fs.list', async ($, e) => {
    lists++
    try {
      const entries = await fake.list(e.path)
      return { value: entries.map(x => ({ ...x, size: 0, isLink: false })) }
    } catch {
      return { deny: 'missing' }
    }
  })
  on('fs.stat', async ($, e) => {
    const s = await fake.stat(e.path)
    return s ? { value: { ...s, size: 0, isLink: false } } : { deny: 'missing' }
  })
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('session.compact', () => ({ messages: MESSAGES }))
  on('tool.call', () => ({ result: 'ok' }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-sonnet-5-5' }))
  on('turn.step', async function* ($, e) {
    const output = e.agentId ? 100 : 10
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: output, cache_read_input_tokens: 1000, cache_creation_input_tokens: 20, model: e.model },
    }
  })
  return { get: key => written[key], toasts, commands, lists: () => lists, reads, writes: key => writeCounts[key] ?? 0, readDelayMs, percent, denyUsage, clock }
}

const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: R })
const complete = ($: any, agentId?: string) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...(agentId ? { agentId } : {}) })

async function step($: any, model: string, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model, messageCount: 1, ...(agentId ? { agentId } : {}) })
  // Read the stream to its end; the generator's return value is the step's result.
  let r = await stream.next()
  while (!r.done) r = await stream.next()
  return r.value
}

test('session.start registers the command and takes options', { options: { warnPercent: 60, language: 'de' } }, async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.commands).toContain('supermod')
  const ui = w.get('ui')
  expect(ui.options.warnPercent).toBe(60)
  expect(ui.options.criticalPercent).toBe(85)
  expect(ui.options.language).toBe('de')
  expect(ui.options.showCost).toBe(true)
  expect(ui.options.reviewMinutes).toBe(10)
  expect(ui.surfaces).toEqual(['terminal'])
  expect(ui.isHidden).toBe(false)
})

test('skill.prompt for a superpowers skill marks the run active', async ($, on) => {
  const w = world(on)
  const answer = await $.skill.prompt({ skill: 'superpowers:brainstorming', text: 'BODY' })
  expect(answer.text).toBe('BODY')
  await $.skill.prompt({ skill: 'commit', text: '' })
  const run = w.get('run')
  expect(run.skillsSeen).toEqual(['superpowers:brainstorming'])
  expect(run.snapshot).not.toBeNull()
})

test('turn.step results accumulate per agent and per model', async ($, on) => {
  const w = world(on)
  const r = await step($, 'claude-opus-5-5')
  expect(r.answer).toBe('')
  expect(r.usage.output_tokens).toBe(10)
  await step($, 'claude-sonnet-5-5', 'a1')
  const models = w.get('models')
  expect(models.totals['claude-sonnet-5-5'].steps).toBe(1)
  expect(models.totals['claude-sonnet-5-5'].output).toBe(100)
  expect(models.totals['claude-opus-5-5'].steps).toBe(1)
  const agents = w.get('agents')
  expect(agents.rows.length).toBe(1)
  expect(agents.rows[0].id).toBe('a1')
  expect(agents.rows[0].usage.output).toBe(100)
  expect(agents.rows[0].lastWindow).toBe(1025)
  expect(agents.rows[0].model).toBe('claude-sonnet-5-5')
})

test('the main loop usage is not attributed to an agent', async ($, on) => {
  const w = world(on)
  await step($, 'claude-opus-5-5')
  // Never written: the agents stay at their initial empty list.
  expect(w.get('agents')?.rows ?? []).toEqual([])
  expect(w.get('models').totals['claude-opus-5-5'].output).toBe(10)
  // A main-loop step reads the context too.
  expect(w.get('context').ring.length).toBe(1)
})

test('agent.spawn adds a row and passes the spawn on', async ($, on) => {
  const w = world(on)
  const r = await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: 'do it',
    description: 'Implement task 3',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })
  expect(r.agentId).toBe('a1')
  const rows = w.get('agents').rows
  expect(rows.length).toBe(1)
  expect(rows[0]).toMatchObject({ id: 'a1', type: 'general-purpose', description: 'Implement task 3', status: 'running', model: 'claude-sonnet-5-5', startedAt: NOW })
})

test('a subagent turn.complete closes its row, so only working agents count', async ($, on) => {
  const w = world(on)
  await $.agent.spawn({
    tool_use_id: 'tu1', prompt: 'do it', description: 'Implement task 3', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
  })
  expect(w.get('agents').rows[0].status).toBe('running')
  await complete($, 'a1')
  const row = w.get('agents').rows[0]
  expect(row.status).toBe('completed')
  expect(row.endedAt).toBe(NOW)
})

test('turn.complete refreshes context and run', async ($, on) => {
  const w = world(on)
  await complete($)
  const context = w.get('context')
  expect(context.ring.length).toBe(1)
  expect(context.ring[0]).toEqual({ at: NOW, percent: 38, tokens: 380_000, window: 1_000_000 })
  const run = w.get('run')
  expect(run.snapshot).not.toBeNull()
  expect(run.snapshot.title).toBe('Englische Ansicht Implementation Plan')
  expect(run.snapshot.completed).toBe(2)
  expect(run.files.planPath).toBe(PLAN)
  expect(run.startedAt).toBe(NOW)
  expect(run.startedWithCompleted).toBe(true)
  expect(run.completions.map((c: { n: number }) => c.n)).toEqual([1, 2])
  expect(run.lastLedger.tasks.length).toBeGreaterThan(0)
  expect(w.get('models').engineUsd).toBe(3.1)
})

test('a crossing raises one toast, a second reading above does not', async ($, on) => {
  const w = world(on)
  w.percent.value = 60
  await complete($)
  w.percent.value = 72
  await complete($)
  w.percent.value = 74
  await complete($)
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toContain('72')
  expect(w.get('context').lastTone).toBe('warning')
  w.percent.value = 90
  await complete($)
  expect(w.toasts.length).toBe(2)
  expect(w.get('context').lastTone).toBe('error')
})

test('session.compact is counted and passed through', async ($, on) => {
  const w = world(on)
  const r = await $.session.compact({ trigger: 'manual', messages: MESSAGES })
  expect(r).toEqual({ messages: MESSAGES })
  await $.session.compact({ trigger: 'precompute', messages: MESSAGES })
  await $.session.compact({ trigger: 'auto', messages: MESSAGES, agentId: 'a1' })
  const context = w.get('context')
  expect(context.compactions).toBe(1)
  expect(context.lastCompactionAt).toBe(NOW)
})

test('a spec written this session becomes the run before a plan exists', async ($, on) => {
  const w = world(on, { [R + '/.git']: { dir: true }, [SPEC]: { text: '# Englische Ansicht\n', mtimeMs: NOW } })
  const r = await $.tool.call({ tool: 'Write', file_path: SPEC, content: '# Englische Ansicht\n' })
  expect(r.result).toBe('ok')
  // The refresh runs on the clock shortly after the call, never inside it.
  await w.clock.advance(2_000)
  const run = w.get('run')
  expect(run.sessionSpec).toBe(SPEC)
  expect(run.referenced).toContain(SPEC)
  expect(run.files.specPath).toBe(SPEC)
  expect(run.snapshot.title).toBe('Englische Ansicht')
})

test('the newest plan counts only once a tool call referenced it', async ($, on) => {
  const w = world(on, planOnlyTree())
  await complete($)
  // Nothing found: the run is never written, so it stays at its empty start.
  expect(w.get('run')?.files ?? null).toBeNull()
  await $.tool.call({ tool: 'Bash', command: 'cat docs/superpowers/plans/2026-10-07-englische-ansicht.md' })
  await w.clock.advance(2_000)
  const run = w.get('run')
  expect(run.referenced).toEqual(['docs/superpowers/plans/2026-10-07-englische-ansicht.md'])
  expect(run.files.planPath).toBe(PLAN)
})

test('a turn that completes after finishing-a-development-branch finishes the run', async ($, on) => {
  const w = world(on)
  await $.skill.prompt({ skill: 'superpowers:finishing-a-development-branch', text: '' })
  await complete($, 'a1')
  expect(w.get('run').finishingTurnCompleted).toBe(false)
  await complete($)
  const run = w.get('run')
  expect(run.finishingTurnCompleted).toBe(true)
  expect(run.snapshot.steps.find((s: { id: string }) => s.id === 'finish').status).toBe('done')
})

test('timers stop while hidden and no pane is open', async ($, on) => {
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  await complete($)
  const before = w.lists()
  await w.clock.advance(30_000)
  expect(w.lists()).toBeGreaterThan(before)
  const answer = await $.command.run({ command: 'supermod', args: 'hide' })
  expect(answer.text).toMatch(/^SuperMod/)
  expect(w.get('ui').isHidden).toBe(true)
  const hidden = w.lists()
  await w.clock.advance(60_000)
  expect(w.lists()).toBe(hidden)
  await $.command.run({ command: 'supermod', args: 'show' })
  expect(w.get('ui').isHidden).toBe(false)
  await w.clock.advance(30_000)
  expect(w.lists()).toBeGreaterThan(hidden)
})

test('a timer tick that finds nothing visible stops the timers', async ($, on) => {
  const w = world(on)
  w.percent.value = 75
  await complete($)
  // Visible only for the context fill; it drops, the next tick stops both timers.
  w.percent.value = 40
  await w.clock.advance(3_000)
  const after = w.lists()
  await w.clock.advance(120_000)
  expect(w.lists()).toBe(after)
})

test('a run in a worktree of the main checkout is found from the main checkout', async ($, on) => {
  const FEAT = R + '/.worktrees/feat'
  const w = world(on, {
    [R + '/.git']: { dir: true },
    [FEAT + '/.git']: 'gitdir: /p/repo/.git/worktrees/feat',
    [FEAT + '/.superpowers/sdd/2026-10-07-englische-ansicht/progress.md']: { text: LEDGER_MID, mtimeMs: NOW - DAY },
    [FEAT + '/.superpowers/sdd/2026-10-07-englische-ansicht/plan-path']: 'docs/superpowers/plans/2026-10-07-englische-ansicht.md\n',
    [FEAT + '/docs/superpowers/plans/2026-10-07-englische-ansicht.md']: { text: PLAN_NINE, mtimeMs: NOW - 4 * DAY },
  })
  await complete($)
  const run = w.get('run')
  expect(run.files.ledgerPath).toBe(FEAT + '/.superpowers/sdd/2026-10-07-englische-ansicht/progress.md')
  expect(run.files.planPath).toBe(FEAT + '/docs/superpowers/plans/2026-10-07-englische-ansicht.md')
  expect(run.snapshot.completed).toBe(2)
})

test('a failed usage read does not skip the run refresh', async ($, on) => {
  const w = world(on)
  w.denyUsage.value = true
  const r = await complete($)
  expect(r.text).toBe('')
  expect(w.get('run').snapshot).not.toBeNull()
  await start($)
  expect(w.commands).toContain('supermod')
  expect(w.get('ui').surfaces).toEqual(['terminal'])
})

test('a tool call returns before the run refresh it starts has finished', async ($, on) => {
  const w = world(on, planOnlyTree())
  w.readDelayMs.value = 5_000
  let isAnswered = false
  const call = $.tool.call({ tool: 'Bash', command: 'cat docs/superpowers/plans/2026-10-07-englische-ansicht.md' }).then(r => {
    isAnswered = true
    return r
  })
  await w.clock.settle()
  expect(isAnswered).toBe(true)
  expect((await call).result).toBe('ok')
  expect(w.get('run').referenced).toEqual(['docs/superpowers/plans/2026-10-07-englische-ansicht.md'])
  // Two more calls within the delay share the one refresh still to come.
  await $.tool.call({ tool: 'Read', file_path: PLAN })
  await $.tool.call({ tool: 'Read', file_path: PLAN })
  await w.clock.advance(2_000)
  expect(w.reads).toEqual([PLAN])
  await w.clock.advance(10_000)
  expect(w.get('run').files.planPath).toBe(PLAN)
  expect(w.reads).toEqual([PLAN, SPEC])
})

test('a refresh that finds the run unchanged reads no file and writes no state', async ($, on) => {
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  await complete($)
  const run = w.get('run')
  expect(run.files.plan.title).toBe('Englische Ansicht Implementation Plan')
  expect(JSON.stringify(run)).not.toContain('### Task')
  expect('refreshedAt' in run).toBe(false)
  const reads = w.reads.length
  const writes = w.writes('run')
  const lists = w.lists()
  await w.clock.advance(30_000)
  expect(w.lists()).toBeGreaterThan(lists)
  expect(w.reads.length).toBe(reads)
  expect(w.writes('run')).toBe(writes)
  // A turn that completes with nothing new leaves the run as it is too.
  await complete($)
  expect(w.reads.length).toBe(reads)
  expect(w.writes('run')).toBe(writes)
})

test('[Hide] lasts until the next run starts', async ($, on) => {
  const NEW_SPEC = R + '/docs/superpowers/specs/2026-10-10-neu-design.md'
  const w = world(on, { ...planOnlyTree(), [NEW_SPEC]: { text: '# Neu\n', mtimeMs: NOW } })
  await $.tool.call({ tool: 'Bash', command: 'cat docs/superpowers/plans/2026-10-07-englische-ansicht.md' })
  await w.clock.advance(2_000)
  expect(w.get('run').files.planPath).toBe(PLAN)
  await $.command.run({ command: 'supermod', args: 'hide' })
  // The same run found again keeps the band hidden.
  await complete($)
  expect(w.get('ui').isHidden).toBe(true)
  // A spec written for the next feature starts a new run.
  await $.tool.call({ tool: 'Write', file_path: NEW_SPEC, content: '# Neu\n' })
  await w.clock.advance(2_000)
  expect(w.get('run').files.specPath).toBe(NEW_SPEC)
  expect(w.get('ui').isHidden).toBe(false)
})
