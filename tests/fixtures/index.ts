// Fixture texts for the ledger and plan tests (the test kit has no file access); the .md files next to this one are copies for humans.

export const LEDGER_MID = "# SDD ledger — plan: docs/superpowers/plans/2026-10-07-englische-ansicht.md\nTask 1: complete (commits a1b2c3d..d4e5f6a, review clean)\nTask 2: fix round 1/5 (2 addressed, 0 open; commits b2c3d4e..e5f6a7b)\nTask 2: complete (commits b2c3d4e..f6a7b8c, 1 parked)\nTask 3: fix round 2/5 (1 addressed, 1 open; commits c3d4e5f..a7b8c9d)\nTask 4: minor (deferred): rename helper\nTask 5: parked — review clean? Ruling: complete later\nTask 6: Ruling: keep the complete flag as is\n"

export const LEDGER_OTHER_PLAN = "# SDD ledger — plan: docs/superpowers/plans/2026-09-30-andere-aufgabe.md\nTask 1: complete (commits 1111111..2222222, review clean)\n"

export const LEDGER_EMPTY = "# SDD ledger — plan: docs/superpowers/plans/2026-10-07-englische-ansicht.md\n"

export const PLAN_NINE = "# Englische Ansicht Implementation Plan\n\n**Spec:** docs/superpowers/specs/2026-10-07-englische-ansicht-design.md\n\n### Task 1: Übersetzungsspeicher\n### Task 2: Übersetzen\n### Task 3: Seite liest Englisch\n## Task 4: Korrekturen\n### Task 5: Sprachumschalter\n### Task 6: Pflegemodus\n### Task 7: Claude Code\n### Task 8: Doku\n### Task 9: Abschlussprüfung\n"

export const PLAN_NO_SPEC = "### Task 1\n"

/** LEDGER_MID as the state stores it: tasks in the order first seen. */
export const LEDGER_MID_STORED = {
  planPath: 'docs/superpowers/plans/2026-10-07-englische-ansicht.md',
  tasks: [{ n: 1, complete: true, fixRound: null }, { n: 2, complete: true, fixRound: 1 }, { n: 3, complete: false, fixRound: 2 }],
}

/** PLAN_NINE as the state stores it. */
export const PLAN_NINE_STORED = {
  title: 'Englische Ansicht Implementation Plan',
  specPath: 'docs/superpowers/specs/2026-10-07-englische-ansicht-design.md',
  tasks: [
    { n: 1, title: 'Übersetzungsspeicher' }, { n: 2, title: 'Übersetzen' }, { n: 3, title: 'Seite liest Englisch' },
    { n: 4, title: 'Korrekturen' }, { n: 5, title: 'Sprachumschalter' }, { n: 6, title: 'Pflegemodus' },
    { n: 7, title: 'Claude Code' }, { n: 8, title: 'Doku' }, { n: 9, title: 'Abschlussprüfung' },
  ],
}
