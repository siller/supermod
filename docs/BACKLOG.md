# Backlog after 0.1.0

Items the per-task and whole-branch reviews deferred as minor. None affects the security posture; the final review placed them all in "can wait".

## Behaviour
- Agent context percent is measured against a 1M window for every agent with a model, because the session's model is not stored. A main-loop `turn.step` carries `e.model`; store it as `models.sessionModel` and pass it to `agentContextPercent`.
- `/supermod use <path>` replies "Following …" even when the guard refuses the pin and discovery falls back to auto; the echoed path is not normalised.
- Unknown command arguments (including a bare `use`) open the pane; there is no usage reply.
- The context breakdown is cut to six rows without a "+n more" row, and arrives up to one 3 s tick after the pane opens.
- Two `$.session.usage` calls per due tick when a breakdown is due; one could serve both.
- The deferred tool-call refresh timer is reset when it fires, not when the refresh completes; bounded to one per 2 s window.
- Spec §4.2 "workflow agents and forks counted under other" is not implemented; `renderPane` ignores `scroll.offset` and relies on host scrolling.
- Spec §7 "at most 80 characters of any title" holds for stored titles; a very wide terminal can still show the full slug in the band.
- After the workspace is deleted, an abandoned older ledger (≤ 7 days) elsewhere in the roots can win discovery over the finished run.
- The ruling-2 filter cannot tell which discovery route found a run; a session-spec run whose plan was never referenced by a tool call is dropped.
- `~/.git` (dotfiles) plus `~/worktrees/<linked>`: the main-checkout inference stops at the `.git` stat; only reading the `gitdir:` line would close it, which §7 forbids.
- POSIX paths only; on Windows no run is shown.

## Parsing and formatting
- Ledger: no regression tests for CRLF, multi-digit task numbers and case sensitivity; `complete\b` also matches `complete-ish`; a header with an empty path yields `""`, not `null`.
- Plan: fence detection handles only ``` (not `~~~` or four-backtick fences); a bare `# ` H1 yields `''` instead of the slug; duplicate task numbers last-wins; the Spec line is recognised only at column 0; trailing punctuation after a bare Spec path is kept.
- The 1 MiB plan threshold counts UTF-16 units, not bytes; width counting is UTF-16 (CJK undercounted, a clip may split a surrogate pair).
- `k(999.6)` prints `1000`; no `Number.isFinite` guards on `openTasks` / `reviewMinutes` in `estimateRange`; `addModel` uses `??` on a plain object (inherited keys); `upsertAgent` with `cap <= 0` could drop the just-added row.
- German labels: `in`/`out` are `ein`/`aus`; `agent.*` labels longer than the 8-cell status column are cut; the `{p}` placeholder means a path in `pinned` and a percent in the toasts.
- Band: `[Details]` ignores `ui.open`'s `isPlaced`; inner `Text` elements are unkeyed; `pending` agents count as running; below 21 (en) / 27 (de) columns the two buttons alone overflow; the title can be shorter at 120 columns than at 80 by design.

## Tests and tooling
- The 50 ms timing test for the tool-input scanner could flake on a loaded CI runner.
- `claude plugin test` runs with `continue-on-error` in CI (sign-in in CI unverified); `@anthropic-ai/claude-code` is installed unpinned there; a stale comment in `check.yml`.
- Missing tests: a symlinked entry inside a worktree folder becoming a root; runtime de/en key parity; `tests/scaffold.test.ts` is titled "every surface" but exercises only vscode; fixtures exist as both `.ts` constants and `.md` copies and can drift.
- The spec's mock-up of the band differs from what is drawn; the README shows the rendered form.
