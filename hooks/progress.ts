// ── Ledger ────────────────────────────────────────────────────────────────
// Parser for the Superpowers 7.0.0 SDD ledger. Only `complete` and `fix round`
// directly after `Task N:` are stations; parked, minor and Ruling lines are not.

export type TaskLedger = { n: number; complete: boolean; fixRound: number | null }
export type Ledger = { planPath: string | null; tasks: Map<number, TaskLedger> }

const LEDGER_HEADER = /^# SDD ledger [—-] plan: (.+)$/m
const LEDGER_TASK = /^Task (\d+): (?:complete\b|fix round (\d+)\/\d+)/gm

/** Reads the plan path and the per-task stations from the ledger text. */
export function parseLedger(text: string): Ledger {
  const header = LEDGER_HEADER.exec(text)
  const tasks = new Map<number, TaskLedger>()
  for (const m of text.matchAll(LEDGER_TASK)) {
    const n = Number(m[1])
    const task = tasks.get(n) ?? { n, complete: false, fixRound: null }
    if (m[2] === undefined) task.complete = true
    else task.fixRound = Number(m[2])
    tasks.set(n, task)
  }
  return { planPath: header ? header[1].trim() : null, tasks }
}

// ── Plan and spec ─────────────────────────────────────────────────────────
// Parsers for Superpowers 7.0.0 plan and spec files. Lines inside fenced code
// blocks are never headings, so example snippets in a plan do not count.

export type Plan = { title: string; specPath: string | null; taskCount: number; taskTitles: Map<number, string> }

const PLAN_TASK = /^#{2,3} Task (\d+)(?::\s*(.*))?$/
const PLAN_SPEC = /^\*\*Spec:\*\*\s*(\S.*)$/
const SPEC_LINK = /^\[[^\]]*\]\(([^)\s]+)\)/
const FENCE = /^\s*```/

/** The lines outside fenced code blocks. */
function proseLines(text: string): string[] {
  const out: string[] = []
  let fenced = false
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) fenced = !fenced
    else if (!fenced) out.push(line)
  }
  return out
}

function firstH1(lines: string[]): string | null {
  const line = lines.find(l => l.startsWith('# '))
  return line === undefined ? null : line.slice(2).trim()
}

/** `2026-10-07-englische-ansicht-design.md` → `englische-ansicht`. */
export function slugFromFileName(name: string): string {
  return name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '').replace(/-design$/, '')
}

/** The path in a Spec line: `[text](path)` gives the path, otherwise the first word minus `[]` or backticks. */
function specPathFrom(rest: string): string {
  const link = SPEC_LINK.exec(rest)
  if (link) return link[1]
  return rest.split(/\s/)[0].replace(/^[[`]+|[\]`]+$/g, '')
}

/** Reads title, spec path and the numbered task headings from a plan. */
export function parsePlan(text: string, fileName: string): Plan {
  const lines = proseLines(text)
  const taskTitles = new Map<number, string>()
  let specPath: string | null = null
  for (const line of lines) {
    const task = PLAN_TASK.exec(line)
    if (task) taskTitles.set(Number(task[1]), (task[2] ?? '').trim())
    const spec = PLAN_SPEC.exec(line)
    if (spec && specPath === null) specPath = specPathFrom(spec[1])
  }
  return { title: firstH1(lines) ?? slugFromFileName(fileName), specPath, taskCount: taskTitles.size, taskTitles }
}

/** The spec's first heading, or the slug of its file name. */
export function specTitle(text: string, fileName: string): string {
  return firstH1(proseLines(text)) ?? slugFromFileName(fileName)
}

// ── Stations and the run model ────────────────────────────────────────────
// Turns ledger, plan and workspace evidence (names and mtimes only) into the
// snapshot the band and pane draw. Weights and credits are constants (spec §5.1).

export type Station = 'none' | 'brief' | 'implementer' | 'review' | 'fix' | 'complete'
export type WorkspaceFile = { name: string; mtimeMs: number }
export type StepId = 'brainstorming' | 'spec' | 'plan' | 'tasks' | 'review' | 'finish'
export type StepState = { id: StepId; status: 'done' | 'active' | 'pending'; done?: number; total?: number }
export type RunEvidence = {
  skillsSeen: Set<string>
  specExists: boolean
  planExists: boolean
  ledger: Ledger | null
  workspaceExists: boolean
  files: WorkspaceFile[]
  plan: Plan | null
  finishingTurnCompleted: boolean
  lastLedger: Ledger | null
  /** Title of the spec written in this session; names the run until a plan takes over. */
  specTitle?: string
}
export type RunSnapshot = {
  title: string
  percent: number
  steps: StepState[]
  currentTask: { n: number; title: string; station: Station } | null
  completed: number
  total: number
}

export const STEP_WEIGHTS: Record<StepId, number> = { brainstorming: 5, spec: 10, plan: 10, tasks: 60, review: 10, finish: 5 }
export const STATION_CREDIT: Record<Station, number> = { none: 0, brief: 15, implementer: 40, review: 70, fix: 85, complete: 100 }

const STEP_ORDER: StepId[] = ['brainstorming', 'spec', 'plan', 'tasks', 'review', 'finish']
const SKILL_BRAINSTORMING = 'superpowers:brainstorming'
const SKILL_PLANS = 'superpowers:writing-plans'
const SKILL_FINISHING = 'superpowers:finishing-a-development-branch'
const SKILLS_EXECUTING = ['superpowers:executing-plans', 'superpowers:subagent-driven-development']

export function creditOf(station: Station): number {
  return STATION_CREDIT[station]
}

/** The highest station task `n` has reached; ledger lines beat workspace files. */
export function stationOf(n: number, ledger: Ledger, files: WorkspaceFile[]): Station {
  const line = ledger.tasks.get(n)
  if (line?.complete) return 'complete'
  if (line && line.fixRound !== null) return 'fix'
  if (files.some(f => f.name === `task-${n}-report.md`)) return 'review'
  const briefs = files.filter(f => /^task-\d+-brief\.md$/.test(f.name))
  const own = briefs.find(f => f.name === `task-${n}-brief.md`)
  if (!own) return 'none'
  return own.mtimeMs >= Math.max(...briefs.map(f => f.mtimeMs)) ? 'implementer' : 'brief'
}

/** Step states, percent, current task and counts for one run. */
export function computeRun(ev: RunEvidence): RunSnapshot {
  const ledger = ev.ledger ?? (ev.workspaceExists ? null : ev.lastLedger)
  const seen = (s: string) => ev.skillsSeen.has(s)
  const finishing = seen(SKILL_FINISHING)
  const numbers = ev.plan ? [...ev.plan.taskTitles.keys()].sort((a, b) => a - b) : []
  const open = numbers.filter(n => !ledger?.tasks.get(n)?.complete)
  const allComplete = numbers.length > 0 && open.length === 0
  const tasksActive = ledger !== null && !allComplete

  const raw: Record<StepId, 'done' | 'active' | 'pending'> = {
    brainstorming: ev.specExists ? 'done' : seen(SKILL_BRAINSTORMING) ? 'active' : 'pending',
    spec: ev.specExists ? 'done' : 'pending',
    plan: ev.planExists && (ledger !== null || SKILLS_EXECUTING.some(seen)) ? 'done' : seen(SKILL_PLANS) && ledger === null ? 'active' : 'pending',
    tasks: allComplete ? 'done' : tasksActive ? 'active' : 'pending',
    review: (!ev.workspaceExists && allComplete) || finishing ? 'done' : allComplete ? 'active' : 'pending',
    finish: finishing && ev.finishingTurnCompleted ? 'done' : finishing ? 'active' : 'pending',
  }
  // A step that is done or active makes every earlier step done.
  let later = false
  for (const id of [...STEP_ORDER].reverse()) {
    if (later && raw[id] !== 'done') raw[id] = 'done'
    if (raw[id] !== 'pending') later = true
  }

  const completed = numbers.length - open.length
  const total = numbers.length
  const stationNow = (n: number): Station => (ledger ? stationOf(n, ledger, ev.files) : 'none')
  const currentN = raw.tasks === 'active' && open.length > 0 ? open[0] : null
  const credit = currentN === null ? 0 : creditOf(stationNow(currentN))

  let percent = 0
  for (const id of STEP_ORDER) {
    const w = STEP_WEIGHTS[id]
    if (raw[id] === 'done') percent += w
    else if (raw[id] === 'active') percent += id === 'tasks' ? (total === 0 ? 0 : (w * (completed + credit / 100)) / total) : w / 2
  }

  const steps: StepState[] = STEP_ORDER.map(id => (id === 'tasks' ? { id, status: raw[id], done: completed, total } : { id, status: raw[id] }))
  const currentTask = currentN === null ? null : { n: currentN, title: ev.plan?.taskTitles.get(currentN) ?? '', station: stationNow(currentN) }
  return { title: ev.plan?.title ?? ev.specTitle ?? '', percent: Math.round(percent), steps, currentTask, completed, total }
}
