# Changelog

## Unreleased

## 0.1.0 – 2026-10-10

- One-line band above the prompt: Superpowers progress with the current task and station, context fill with warning and critical colours and one toast per crossing, running agents, remaining-time range; width-aware down to 80 columns.
- Detail pane (`/supermod`): overall progress, per-step status, context window with history and breakdown, agents, tokens and cost, remaining time.
- `/supermod` arguments `hide`, `show`, `status`, `use <path>` and `use auto`; `status` is the text fallback for surfaces that draw nothing. `[Hide]` and `/supermod hide` last until the next run starts or `/supermod show`.
- Options `language` (en, de), `warnPercent`, `criticalPercent`, `showCost`, `reviewMinutes`.
- Understands the Superpowers 7.0.0 ledger and workspace conventions; strictly read-only file access inside the repository; the validator's hooks and calls are listed in the README and checked in CI.
- Files are stat'ed before they are read and an unchanged file is not read again; the state keeps only parsed values, never file text, and is written only when something changed. A tool call that names a run path refreshes the run shortly after, never holding up the tool's result; tool inputs are scanned in linear time.
