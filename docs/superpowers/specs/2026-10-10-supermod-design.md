# SuperMod: a Claude Code mod that shows Superpowers progress, context fill and agents

Date: 2026-10-10 · Status: builder check done, awaiting owner approval · License: MIT · Author: Mark Siller (GitHub `siller`)

## 1. Intent

When working with Claude Code and the Superpowers plugin, the person steering the session cannot see three things without interrupting the work: how far the current Superpowers run has come (overall and per step), how full the main context window is and whether it keeps getting exhausted, and what the subagents are doing and costing. SuperMod draws exactly that, always, as a one-line band above the prompt and a detail pane on demand, so the person can judge at a glance whether the run is healthy and roughly how long it still needs.

The owner's first priorities are task progress and the context window. Token usage, cost and the remaining-time estimate are secondary and must never crowd the two priorities out.

## 2. Goals, non-goals, anti-goals

Goals

- Show Superpowers progress overall (percent) and per step, with partial credit per task station.
- Show the main context window fill (percent, tokens, window), with a warning threshold, a short history and the last compaction.
- Show the session's agents: status, type, model, context fill, tokens, elapsed time.
- Show token totals per model, an estimated cost clearly labelled as an estimate, and a rough remaining-time range.
- Same mod, same code, same look on every surface that can draw: terminal (including an editor's integrated terminal) and the Desktop app. Graceful text fallback where nothing draws.
- Installable by anyone with one line from a public GitHub marketplace; English by default, German selectable.
- Pass a security review by inspection: `claude plugin validate` must list only the calls in §7, nothing else.

Non-goals

- Steering the run. SuperMod never rewrites a prompt, a tool call or a request, never submits prompts, never spawns agents, never compacts.
- Nudging Claude. No text reaches the model from SuperMod. Threshold crossings change colours and raise a toast for the person only.
- Replacing Superpowers' own ledger or todo tracking. SuperMod only reads what Superpowers writes.
- Exact billing. Cost is a list-price estimate from token counts.
- Support for Superpowers forks or other frameworks in v1 (savvy-flow, GSD, Compound Engineering).

Anti-goals (failure even if it works)

- Any network access, process spawn, file write, environment or settings read beyond the plugin's own `userConfig` options.
- Reading files outside the session's working directory tree.
- Visible lag or flicker in the prompt area; a timer that runs when nothing is shown.
- A band that appears during unrelated work (dashboard content edits, quick questions) when no Superpowers run is active and the context is healthy.

## 3. Constraints

- Platform: Claude Code mods (function hooks), early-access API. Tested against Claude Code 2.1.296; the README states the tested version. The types the engine writes beside the mod (`.claude-plugin/types/claude-code/index.d.ts`) are authoritative over any doc.
- Where mods draw, per Anthropic's documentation (2026-10): terminal sessions and the Desktop app's Code tab draw panes and bands. The VS Code extension's chat panel, `claude -p`, the Agent SDK and cloud sessions run the hooks but draw nothing. SuperMod therefore offers a text reply (`/supermod status`) as the fallback there, and the README tells VS Code users to run Claude Code in the integrated terminal to get the band and pane.
- Three source files plus a types contract, TypeScript/TSX, no build step, no dependencies, no bundler.
- The plugin name is `supermod` (checked: no existing Claude Code mod of that name as of 2026-10-10). Names starting with `claude-` are refused by the validator.
- Superpowers 7.0.0 conventions (verified in its skills and scripts): workspace `<worktree-root>/.superpowers/sdd/<plan-basename>/` (created at the git toplevel of the tree the run executes in), marker file `plan-path`, ledger `progress.md` whose first line is `# SDD ledger — plan: <plan file path>`, task lines `Task N: fix round k/5 (…)`, `Task N: complete (commits …, review clean | K parked)`, `Task N: minor (deferred): …`, `Task N: parked — … Ruling: …`, `Task N: Ruling: …`. The ledger writes no lines for brief, implementer or review; those stations leave files in the workspace instead: `task-N-brief.md`, `task-N-report.md`, `review-<base>..<head>.diff`. Both execution skills delete the workspace after the final review is clean, before `finishing-a-development-branch` runs. Plans live in `docs/superpowers/plans/YYYY-MM-DD-<name>.md` and carry a `**Spec:** <path>` header; specs in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`. Superpowers runs in a worktree it creates (`.worktrees/<branch>/` or `worktrees/<branch>/` under the main checkout) or in a Claude Code worktree (`.claude/worktrees/<name>/`). Superpowers may change any of this; SuperMod pins the format it understands and shows "unknown" rather than guessing.
- Width: a band row that exceeds `bodyColumns` wraps and pushes the prompt (observed with the spike at 80 columns). Every row is planned against the width; this is a tested requirement, not a nicety.

## 4. What the person sees

### 4.1 Band above the prompt (always one line)

```
SuperMod  Englische Ansicht  ████████░░░░░░░░ 44%  Task 5/9 · implementer  ctx ████░░░░░░ 38%  agents 2  ~25–40 min  [Details] [Hide]
```

Left to right: plan title (plan file name without date prefix, truncated to fit), overall progress bar and percent, current task with its station, context bar and percent in the threshold colour, number of running agents, remaining-time range, two buttons. Width-aware: with fewer `bodyColumns` the band drops, in this order, the time range, the agent count, the task station, the plan title.

When the band shows

- A Superpowers run is active in this session: a `superpowers:*` skill prompt was expanded in this session, or a ledger or plan under the working tree changed in the last 7 days and was referenced by a tool call in this session.
- Or the main context is at or above the warning threshold, regardless of Superpowers.
- Otherwise the band yields (`next(e)`), and `[Hide]` hides it until the next run starts or the person runs `/supermod show`.

Colours: green below the warning threshold, yellow from warning, red from critical. Defaults 70 and 85 percent, both `userConfig` options. A crossing upward into yellow or red raises one toast ("Context 72 %: consider finishing the task in a fresh subagent or compacting"); no toast repeats until the fill drops below the threshold again.

No animation. The band changes only when data changes.

### 4.2 Pane (`/supermod`, or the `[Details]` button)

Opened with `$.ui.open({ id: 'supermod', title: 'SuperMod' })`, docked beside the transcript where the surface docks panes, inline otherwise. Sections, top to bottom, each a fixed-width monospace block sized to `bodyColumns`:

1. Progress overall: plan title and path, bar, percent, started at, elapsed.
2. Per step: Brainstorming, Spec, Plan, Tasks, Review, Finish. Each with a mark (done ✓, active ▶, pending ·), and for Tasks the bar `done/total` plus the current task's title and station.
3. Context window: bar, percent, tokens of window, threshold; a sparkline of the last 30 readings; time of the last compaction and how many so far this session; the `/context`-style breakdown by category when available (`breakdown: 'summary'`, never `'full'`, which would send token-count requests).
4. Agents: one row per agent of the session, newest first, capped at the pane's rows: status mark, type, model (short), context percent, tokens in/out, elapsed. Finished agents dim. Workflow agents and forks appear when the engine lists them; otherwise they are counted under "other".
5. Tokens and cost: totals per model (input, cache read, cache write, output), cache-hit share, estimated cost with the label "estimate at list price, not a bill". Hidden entirely when the `showCost` option is off.
6. Remaining time: average duration of completed tasks in this run × open tasks, plus a review allowance, shown as a range (×0.7 to ×1.5). Shown only once at least two tasks have completed in this session; before that "not enough data".

### 4.3 Command

`/supermod` opens the pane. Arguments: `hide`, `show`, `status` (prints the band's content as text, the fallback for surfaces that draw nothing), `use <plan-or-ledger-path>` (pins the run to follow), `use auto` (unpins). The command's text reply is the same on every surface.

### 4.4 Language

`userConfig` option `language`: `en` (default) or `de`. All labels come from one table in `hooks/i18n.ts`; no label string lives in the render code. Numbers use a plain format (`1.2M`, `381k`), no locale-specific separators, so the band stays the same width in both languages.

## 5. Data: sources and rules

### 5.1 Superpowers progress

Step detection, in this order of evidence:

| Step | Done when | Active when |
| --- | --- | --- |
| Brainstorming | a spec file for this run exists, or a later step is active | `skill.prompt` for `superpowers:brainstorming` seen and no spec yet |
| Spec | `docs/superpowers/specs/<slug>-design.md` exists | brainstorming done, plan missing |
| Plan | plan file exists and its workspace has a ledger, or executing/SDD skill prompt seen | `skill.prompt` for `superpowers:writing-plans` seen, no ledger yet |
| Tasks | every task of the plan has a `Task N: complete` ledger line | ledger exists with open tasks |
| Review | the workspace disappears after every task was complete, or `finishing-a-development-branch` prompt seen | last task complete, workspace still present |
| Finish | `finishing-a-development-branch` prompt seen and the turn in which it was seen completed | `finishing-a-development-branch` prompt seen |

SuperMod keeps the last ledger snapshot of the run in `$.state`, so the run's progress survives the workspace deletion that both execution skills perform after the final review. A session that finds only a plan file and no ledger, and saw no Superpowers skill in this session, shows no run rather than guessing between "planned" and "finished" (telling them apart would need git, which §7 forbids). A finished run stays visible at 100 % until the next run starts or the person hides the band.

Linking the pieces of one run: the workspace's `plan-path` marker names the plan; the plan's `**Spec:** <path>` header names the spec. File-name similarity is not used. Before a plan exists, the run is the spec written in this session (a `Write` or `Edit` tool call to `docs/superpowers/specs/*-design.md` observed in this session, newest wins), and the spec's title (first `#` heading, else the file name without date and `-design`) is the band title; once a plan names that spec, the plan takes over as the run.

Task total: count of `Task N` headings in the plan file (`### Task N` or `## Task N`, with or without a title after a colon). Current task: the first task without a `complete` ledger line.

Station credit for the current task, as a percent of one task, from workspace evidence (existence and mtime only, contents are never read) and ledger lines, taking the highest station reached:

| Station | Evidence | Credit |
| --- | --- | --- |
| Brief written | `task-N-brief.md` exists | 15 |
| Implementer running | `task-N-brief.md` exists and no `task-N-report.md` yet, and the brief is the newest brief | 40 |
| Review running | `task-N-report.md` exists, or a `review-*.diff` newer than the report | 70 |
| Fix round | ledger line `Task N: fix round k/5` | 85 |
| Complete | ledger line `Task N: complete` | 100 |

Ledger lines are matched with anchored patterns on the text right after `Task N:` (`complete`, `fix round`), so the words inside `parked`, `minor` and `Ruling` lines do not count as stations. Native (inline) execution writes no briefs or reports; a task then goes 0 → (85) → 100, which is acceptable and documented.

Step weights for the overall percent: Brainstorming 5, Spec 10, Plan 10, Tasks 60, Review 10, Finish 5. Tasks contribute `60 × (completed + currentCredit/100) / total`. A done step contributes its full weight, an active non-task step half, a pending step nothing. The weights are constants in one place; not user-configurable in v1.

Which run: pinned path first; else the ledger with the newest modification time in the last 7 days among the search roots; else the spec written in this session; else the newest plan under `docs/superpowers/plans` modified in the last 7 days and referenced by a tool call in this session; else no run.

Search roots, all inside one repository: the session's project root (`$.session.root()`); when that root is itself a worktree (its path contains `/.claude/worktrees/<name>`, `/.worktrees/<name>` or `/worktrees/<name>`), also the main checkout above that segment; and under the main checkout the worktree folders `.claude/worktrees/*`, `.worktrees/*`, `worktrees/*`. In each root SuperMod looks only at `.superpowers/sdd/*/`, `docs/superpowers/plans/` and `docs/superpowers/specs/`. It never lists a parent of the repository or any sibling directory.

Refresh: ledger, workspace listing and plan are re-read after each `turn.complete`, after each `tool.call` whose input mentions a ledger, workspace or plan path, and on a 30-second timer while the band or the pane is visible. Stat before read; unchanged mtime skips the read.

### 5.2 Context window

`$.session.usage()` after every main-thread `turn.step` result and on `turn.complete`; `percent`, `tokens`, `window` as the engine reports them (the status line's figures). A reading goes into a ring buffer of 30 for the sparkline. `session.compact` observed (pass-through, never answered) records the time and count of compactions. The breakdown is requested with `breakdown: 'summary'` only while the pane is open, at most every 30 seconds.

### 5.3 Agents

`agent.spawn` adds a row (id, type, description, started at, parent). `$.agent.list()` refreshes status on every refresh. `turn.step` results with an `agentId` accumulate that agent's usage (input, cache read, cache write, output, model, last request window). Per-agent context percent = last request window ÷ the context window of that agent's model, using the engine's session window as the approximation when the model matches the session's, else a built-in table (1M for every current model except where the engine says otherwise); labelled as approximate in the pane. Rows are kept for the session, capped at 200.

### 5.4 Tokens and cost

Totals per model from the same `turn.step` results, main thread included. The headline cost is the engine's own session total (`$.session.usage()` → `cost.usd`, the figure `/cost` shows), labelled as such. The per-model split is a local estimate from `hooks/prices.ts` (first-party list prices per model family and version, input, output, cache read, cache write per million tokens, with a date stamp and a fallback row) and is labelled "estimate at list price". When the engine reports no cost (a host without a cost ledger), the local estimate becomes the headline, labelled "estimate". `showCost` option (default on) hides the whole section.

### 5.5 Remaining time

SuperMod records the wall-clock time when it first observes each `Task N: complete` line; task duration = difference to the previous completion (or to run start for the first). Estimate = median duration × open tasks + review allowance (default 10 minutes, `reviewMinutes` option). Range = 0.7× to 1.5×. Shown only with two or more completed tasks observed in this session; after a resume the history is empty and the estimate waits.

## 6. Architecture

```
supermod/
├── .claude-plugin/
│   ├── plugin.json          name supermod, version, description, author, types, userConfig (language, warnPercent, criticalPercent, showCost, reviewMinutes)
│   └── marketplace.json     one entry, source "./", so the repo is its own marketplace
├── hooks/
│   ├── hooks.json           { "modules": ["./register.tsx"] }
│   ├── register.tsx         hooks and rendering only; no parsing logic
│   ├── progress.ts          plan and ledger parsing, step and credit rules, run selection (pure functions)
│   ├── usage.ts             context ring buffer, agent and model accumulators, cost (pure functions)
│   ├── eta.ts               remaining-time estimate (pure)
│   ├── i18n.ts              label table en/de
│   └── prices.ts            price table with date
├── types/index.d.ts         PluginState contract: run, snapshot, agents, usage, history, ui flags
├── tests/                   *.test.ts for claude plugin test, plus fixtures/ with ledger and plan samples
├── README.md                install line, what it shows, what it reads, tested version, surfaces table, options
├── CHANGELOG.md
└── LICENSE                  MIT
```

Hooks: `session.start` (register command, start timers), `command.run{supermod}`, `skill.prompt` (observe superpowers skills, pass through), `tool.call` (observe paths in inputs, including specs written this session, pass through), `turn.step` (streaming pass-through, read result usage), `turn.complete` (refresh), `agent.spawn` (observe), `session.compact` (observe), `ui.render{AbovePrompt}`, `ui.render{Pane, requestId=supermod}`. Every observing hook passes the event on unchanged; none answers for itself except `command.run{supermod}`.

State lives in `$.state` under the contract, never in module variables, so hot reloads and engine restarts keep the snapshot. Rendering reads state only; writes happen in event hooks and timers. Timers run only while something is visible; the 30-second file refresh stops when the band yields and the pane is closed.

Width handling: every row is built from a column plan against `e.props.bodyColumns`; no row may exceed it (a wrapped band row would push the prompt).

## 7. Security posture

Allowed engine calls, the complete list the validator must show: `$.command.register`, `$.ui.open`, `$.ui.close`, `$.ui.resolve`, `$.ui.toast`, `$.ui.panes`, `$.session.usage`, `$.session.surfaces`, `$.session.root`, `$.agent.list`, `$.clock.now`, `$.clock.every`, `$.clock.after`, `$.fs.read`, `$.fs.stat`, `$.fs.list`, `$.state.get`, `$.state.set`. No `$.plugin.root`: v1 ships no asset that is read at run time.

Forbidden, and a CI check fails the build if the validator lists any: `$.process.*`, `$.model.*`, `$.prompt.*`, `$.agent.spawn`, `$.tool.register`, `$.session.append`, `$.session.send`, `$.session.compact`, `$.fs.write`, `$.fs.remove`, `$.env.*`, `$.settings.*`, `$.store.*`, any HTTP client.

File access, all under the search roots of §5.1 and nowhere else: `$.fs.read` only on `docs/superpowers/plans/*.md`, `docs/superpowers/specs/*-design.md`, `.superpowers/sdd/*/progress.md` and `.superpowers/sdd/*/plan-path`; `$.fs.list` only on `docs/superpowers/plans/`, `docs/superpowers/specs/`, `.superpowers/sdd/`, each `.superpowers/sdd/<plan>/` (for the station files, names only) and the three worktree folders (names only, to find further roots); `$.fs.stat` on the same paths. Brief, report and diff files are never read, only listed and stat'ed. Reads are capped by the engine at 4 MiB; SuperMod reads the ledger whole and only the headings of a plan over 1 MiB. Every path is resolved with `stat({ resolve: true })` and refused when its `realPath` leaves the search roots (a symlink out of the repository).

Inputs are untrusted text: ledger and plan content and tool-call inputs are parsed with anchored regular expressions and never evaluated, never echoed into a prompt, never passed to a command. The pane shows at most 80 characters of any title.

The README carries the validator's `hooks:` and `calls:` lines verbatim so a reader can compare them with their own run.

## 8. Testing

- Pure modules (`progress.ts`, `usage.ts`, `eta.ts`) have unit tests with fixture ledgers covering: fresh ledger, mid-task at each station, fix rounds, all complete, a ledger naming another plan, native execution with sparse lines, a malformed line, a plan with collision-suffixed workspace.
- `claude plugin test`: mount the band and the pane on `terminal` and `desktop` (and `vscode` for the text fallback) with mocked `$.session.usage`, `$.agent.list`, `$.fs` and the clock; assert threshold colours, band degradation at 80, 100 and 120 columns with no row wider than `bodyColumns`, toast once per crossing, timer stops when hidden, `/supermod status` text, station credit from workspace file fixtures, no file access outside the search roots (a fixture tree with a sibling project that must stay untouched).
- Manual checklist before each release: terminal, Desktop app, VS Code integrated terminal, VS Code chat panel (fallback only), a real Superpowers run with subagent-driven and with native execution, a resume after compaction.
- `claude plugin validate` output compared against §7 in CI (a shell check in a GitHub Action, runnable locally).

## 9. Distribution

Public repository `github.com/siller/supermod`, MIT, created and pushed as part of the build (the owner's `gh` is logged in to github.com as `siller`; the Bechtle GitHub Enterprise host the shell defaults to must not be used: every `gh` call for this project passes `GH_HOST=github.com` or `--repo siller/supermod`). Install line in the README: `/plugin install supermod --marketplace siller/supermod` (terminal session; Desktop sessions pick the user-scope install up). Semantic versions in `plugin.json`; `CHANGELOG.md` per release; the README names the Claude Code version each release was tested with and that the mods API is early access. A `v0.x` series until the API is stable. No Bechtle reference anywhere in the repository.

## 10. Left to the builder

- Exact column plan and truncation order inside the pane sections, and the sparkline glyphs.
- Heading levels and task-numbering variants to accept in plan files, beyond those listed.
- The shape of the state contract and the ring-buffer sizes.
- Whether the GitHub Action runs `claude plugin test` (needs the CLI in CI) or only `validate` plus the unit tests under Node.
- Short model-name mapping in the agents table.
- How `use <path>` resolves a relative path (against cwd first, then the main checkout).

## 11. Decisions already made, by whom

- Band plus pane on demand (owner). Priorities: tasks and context first (owner).
- Passive only: colour and toast, no hint to the model (owner).
- Partial credit per station (owner). Step weights, credit values, thresholds 70/85, range factors, review allowance: author's calls, all constants or options.
- Name SuperMod, private GitHub account, MIT (owner). English default, German via option (owner).
- Station evidence from workspace file names (option b), accepted by the owner with the wider listing scope it implies (owner).
- Repository under the owner's private GitHub account `siller`, created and pushed by the build (owner).
- Band visibility rule, text fallback for non-drawing surfaces, strict read-only file scope, Review and Finish detection via workspace deletion and the finishing skill, spec link via the plan's `**Spec:**` header, worktree search roots, engine cost as headline: author's calls after the builder check.
