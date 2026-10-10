# SuperMod

SuperMod is a Claude Code mod that shows, inside the session, how far a Superpowers run has come, how full the main context window is, and what the subagents are doing. It draws a one-line band above the prompt and a detail pane on demand. It only reads and observes: it never steers the run, never sends text to the model and never writes a file.

## What it shows

The band above the prompt is always one line. On a wide terminal it reads:

```
englische-ansicht  █████░░░░░░░ 44%  Task 5/9 · Implementer  ctx ███░░░░░ 38%  Agents 2  ~25–40 min [ Details ] [ Hide ]
```

and at 80 columns:

```
englische-ansicht  ███░░░ 44%  Task 5/9  ctx ██░░░░ 38% [ Details ] [ Hide ]
```

From left to right: the run's name (the plan's file name without its date, or the spec's title before a plan exists), the overall progress bar and percent, the current task with its station, the context bar and percent, the number of running agents, the remaining-time range, and two buttons. With no run, when the band shows only for the context fill, the row starts with `SuperMod` instead. The context figure is green below the warning threshold, yellow from it and red from the critical threshold. A crossing upward raises one toast for the person only; nothing reaches the model. With fewer columns the bars shrink first, then the band drops, in this order, the time range, the agent count, the task station and the run's name. No band row is wider than the terminal.

The band shows while a Superpowers run is active in the session, or while the context is at or above the warning threshold. Otherwise it stays out of the way. `[Hide]` hides it until the next run starts or `/supermod show` is run.

The pane (`/supermod`, or `[Details]`) has these sections:

1. Progress overall: plan title and path, bar, percent, start time, elapsed time.
2. Per step: Brainstorming, Spec, Plan, Tasks, Review, Finish, each done, active or pending; for Tasks the `done/total` bar and the current task with its station.
3. Context window: bar, percent, tokens of the window, thresholds, a sparkline of the last 30 readings, the last compaction and how many so far, and the `/context`-style breakdown by category when available.
4. Agents: one row per agent of the session, newest first, with status, type, model, approximate context percent, tokens in and out, and elapsed time.
5. Tokens and cost: totals per model and the cost. The session total is the engine's own figure; the per-model split is an estimate at list price, not a bill. Hidden when the `showCost` option is off.
6. Remaining time: the median duration of the tasks completed in this session times the open tasks, plus a review allowance, as a range. Shown after at least two completed tasks; before that it says "not enough data".

## Install

In a terminal session:

```
/plugin install supermod --marketplace siller/supermod
```

Answer `y` to add the marketplace and choose the user scope. Desktop sessions pick up a user-scope install.

## Where it draws

| Surface | Band and pane | `/supermod status` |
| --- | --- | --- |
| Terminal, including an editor's integrated terminal | yes | yes |
| Desktop app, Code tab | yes | yes |
| VS Code extension, chat panel | no | yes |
| `claude -p`, Agent SDK | no | yes |
| Cloud sessions | no | yes |

Where nothing is drawn the hooks still run, and `/supermod status` prints the band's content as text. VS Code users who want the band and the pane run `claude` in the editor's integrated terminal.

## The `/supermod` command

| Command | Effect |
| --- | --- |
| `/supermod` | Opens the pane. |
| `/supermod hide` | Hides the band until the next run starts or `/supermod show`. |
| `/supermod show` | Shows the band again. |
| `/supermod status` | Replies with the band's content as text, on every surface. |
| `/supermod use <plan-or-ledger-path>` | Follows that run instead of the newest one; a relative path is resolved against the session's project root. |
| `/supermod use auto` | Goes back to following the newest run. |

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `language` | `en` | Language of the texts: `en` or `de`. |
| `warnPercent` | `70` | Context fill in percent at which the band turns yellow and a toast appears (1 to 99). |
| `criticalPercent` | `85` | Context fill in percent at which the band turns red and a toast appears (1 to 100). |
| `showCost` | `true` | Show the cost section of the pane. |
| `reviewMinutes` | `10` | Minutes of review allowance added to the remaining-time estimate (0 to 240). |

Set them in `/config`, or under `pluginConfigs` in the Claude Code settings.

## What it reads and calls

SuperMod reads only these files, all inside the repository of the session (its project root, the main checkout above it when the root is a worktree, and the worktree folders `.claude/worktrees/*`, `.worktrees/*` and `worktrees/*` of that main checkout):

- `docs/superpowers/plans/*.md`
- `docs/superpowers/specs/*-design.md`
- `.superpowers/sdd/*/progress.md`
- `.superpowers/sdd/*/plan-path`

It lists the directories that hold them, the file names inside each `.superpowers/sdd/<plan>/` workspace (brief, report and diff files are never opened, only their names and times are used), and the three worktree folders. It stats `.git` to tell a main checkout from a linked worktree. A path whose real location leaves those roots, such as a symlink out of the repository, is refused. Every file is stat'ed before it is read, and one whose modification time has not changed since it was last read is not read again; the mod's state keeps only what it parsed from a file (titles of at most 80 characters, task numbers, ledger stations), never the file's text.

To learn which run the session works on, the `tool.call` hook looks at each tool call's `file_path`, `path`, `command` and `prompt` inputs for paths of the shapes above. It keeps those paths (the last 100, each at most 512 characters) in its state, refreshes the run shortly after the call without holding up the tool's result, and never runs or opens anything a tool input names. The tool call itself passes on unchanged.

Paths are handled as POSIX paths. On Windows SuperMod finds no run; the context fill, the agents and the cost still work.

`claude plugin validate --strict .` reports these hooks and calls for the mod:

```
./register.tsx hooks: session.start, command.run{command=supermod}, ui.render{component=Pane, requestId=supermod}, ui.render{component=AbovePrompt}, skill.prompt, tool.call, turn.step, turn.complete, agent.spawn, session.compact
./register.tsx calls: $.agent.list (via refreshUsage), $.clock.after (via refreshRunSoon), $.clock.every (via startTimers), $.clock.now, $.command.register, $.fs.list (via fsOf), $.fs.read (via fsOf), $.fs.stat (via fsOf), $.session.root, $.session.surfaces, $.session.usage (via refreshBreakdown, refreshContext), $.state.get, $.state.set, $.ui.open, $.ui.panes (via refreshUsage), $.ui.resolve, $.ui.toast (via refreshContext)
```

The validator prints a few more lines for the mod: the state it declares, reads and writes (`supermod.run`, `supermod.context`, `supermod.agents`, `supermod.models`, `supermod.ui`), that it answers its own command `command.run{command=supermod}`, and `gating hook without .catch` for `tool.call`, `agent.spawn` and `session.compact`. Those three hooks only observe: each passes its event on unchanged, and should one of them fail, the engine skips it and carries on with the event as if SuperMod were not installed, so they need no `.catch`.

Compare them with your own run. SuperMod never writes files, starts processes, reads environment variables or settings, or uses the network. `scripts/check-calls.sh` fails the CI build if the validator lists any call outside the allow list.

Cost figures are estimates at list price (`hooks/prices.ts`), except the session total, which is the engine's own.

## Superpowers compatibility

SuperMod understands the conventions of Superpowers 7.0.0: the workspace `.superpowers/sdd/<plan-basename>/` with the marker file `plan-path` and the ledger `progress.md`, plans in `docs/superpowers/plans/` with a `**Spec:**` header, and specs in `docs/superpowers/specs/*-design.md`. Where the format differs it shows "unknown" or no run rather than guessing.

Station credit for the current task comes from the ledger lines and from the names of the files in the workspace. In subagent-driven execution the brief, the implementer, the review and the fix rounds each count as a station. In native (inline) execution Superpowers writes no briefs or reports, so a task goes from 0 to 85 (fix round, if any) to 100 when its `complete` line appears.

Both Superpowers execution skills delete the workspace after the final review. SuperMod keeps the last ledger snapshot in its own state, so a finished run stays visible at 100 percent until the next run starts or the band is hidden with `[Hide]`.

## Requirements

- Claude Code v2.1.287 or later, for mods. Tested on 2.1.296.
- The mods API is early access and may change; SuperMod may need updates when it does.

## Before each release

The maintainer checks these by hand (they need real sessions, so CI cannot):

- [ ] Terminal at 80 columns and at 120 columns: no band row wraps, the band degrades in the documented order.
- [ ] Desktop app, Code tab: band and pane.
- [ ] VS Code integrated terminal: band and pane.
- [ ] VS Code chat panel: nothing drawn, `/supermod status` replies with text.
- [ ] One real Superpowers run in subagent-driven mode: the band appears at brainstorming, the stations advance, a toast appears at a forced low `warnPercent`.
- [ ] A real run in native execution mode: a task goes 0, then 100.
- [ ] Resume after `/compact`: progress stays, the remaining-time estimate waits.

## Development

```
claude --plugin-dir .                 # run Claude Code with the mod loaded
claude plugin test                    # unit and mount tests
claude plugin validate --strict .     # manifest, hooks and calls
bash scripts/check-calls.sh .         # fails on any call outside the allow list
```

The CI workflow (`.github/workflows/check.yml`) runs validate and the call check. `claude plugin test` runs there with `continue-on-error`, because signing in on CI is not verified yet.

## License

MIT. See `LICENSE`.
