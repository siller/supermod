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
