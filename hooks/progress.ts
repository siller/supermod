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
