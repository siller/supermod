# Changelog

## Unreleased

## 0.1.0 – unreleased

- One-line band above the prompt: Superpowers progress with the current task and station, context fill with warning and critical colours and one toast per crossing, running agents, remaining-time range; width-aware down to 80 columns.
- Detail pane (`/supermod`): overall progress, per-step status, context window with history and breakdown, agents, tokens and cost, remaining time.
- `/supermod` arguments `hide`, `show`, `status`, `use <path>` and `use auto`; `status` is the text fallback for surfaces that draw nothing.
- Options `language` (en, de), `warnPercent`, `criticalPercent`, `showCost`, `reviewMinutes`.
- Understands the Superpowers 7.0.0 ledger and workspace conventions; strictly read-only file access inside the repository; the validator's hooks and calls are listed in the README and checked in CI.
