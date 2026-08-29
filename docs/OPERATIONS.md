# Operations

Day-to-day use, and what to do when something misbehaves.

## Daily loop

```bash
npm run serve:start     # once per working session — removes process boot from every call
npm run doctor          # after any config change, or when a run behaves oddly
```

Then, per task: `classify` → dispatch → verify, then `/clear` once the branch lands so the
next task starts on a clean context — the loop keeps no state between tasks, and stale
exploration left in the window gets re-read on every subsequent turn. The skills in
`~/.claude/skills/` carry the detail; this file covers the operational edges.

Write the request itself in the four-field shape from `REQUEST-BRIEF.md` — it is what lets
the orchestrator skip its own exploration and go straight to a dispatch.

## Per-repo standardisation

Drop `.agent-system.json` at a target repo's root (seed it from
`templates/project/agent-system.json`) to fix that repo's routing once — `tier`, `model`,
`scope`, `seed`, `template`, and a baseline `anti` list. After that a dispatch into it is
just `--task`, and it behaves the same on every machine. CLI flags override the file,
`--anti` adds to its baseline, `--no-config` ignores it, `--dry-run` shows what resolved.

Scope enforcement is on by default now: tracked files edited outside `--scope` are
reverted (`strays_kept` in the result lists untracked ones for you to delete;
`--keep-strays` turns the revert off). A dispatch whose scope overlaps one already
running in the same working directory is refused rather than allowed to race the tree —
run one task per repo at a time, or give concurrent runs disjoint scopes.

Judge a run by `touched`, not `changed`: `changed` misses files that were already dirty
when the run started, so on an uncommitted tree it can read as "did nothing" when the
delegate rewrote a whole file. Committing between dispatches keeps that signal honest.

## Latency, in order of payoff

Measured: warm invocation overhead is ~7s. Cold start is >2min, once. Everything beyond
that fixed cost is the delegate doing real work — mostly *finding* things.

1. **`--seed` the files.** Every file the delegate has to locate costs a glob/grep
   round-trip before work starts. You usually already know which files matter. This is
   the largest and cheapest win.
2. **`--session <id>`** for follow-ups on the same area — reuses built-up context instead
   of re-exploring. The previous result's `session` field is the id.
3. **Warm server** — `npm run serve:start`.
4. **Right-size the tier.** Tier 3 is slower and no better at a badly specified task.
5. **Dispatch independent tasks concurrently** — separate scopes, one call each.

## Cost

The delegate's spend is flat-rate, so it is not a budget to protect — but it does track
how much real work happened, which makes it a useful signal.

```bash
npm run ledger                    # recent runs
node scripts/ledger.mjs --by-model    # pass rate, avg time, avg cost, stray count
node scripts/ledger.mjs --failures    # what went wrong
```

`--by-model` is how tier placement gets corrected over time. The current table is partly
inferred from model names; the ledger replaces that guess with this machine's results.
Note that its pass rate counts scope violations and errors, **not** code correctness — a
run can pass there and still be wrong.

## Troubleshooting

**A run hangs and produces nothing.**
Usually a tool `permission` set to `"deny"` somewhere. Denial stalls the loop rather than
degrading. Cap `steps` instead of denying tools. `npm run doctor` flags this.

**A run aborts mid-way with no output.**
A denied permission with `continue_loop_on_deny` off. Confirm with `npm run doctor`.

**The delegate wanders outside the repo or does something unasked.**
It is reading an instruction file meant for something else. opencode ingests
`~/.claude/CLAUDE.md` and any `AGENTS.md`/`CLAUDE.md` in the project. Check what those
say — the delegate is usually obeying, not misbehaving. `npm run doctor` checks the
global file for orchestration protocol leaking through.

**A `--seed` file reports "File not found" against a warm server.**
Fixed 2026-08-22: `-f` paths are now resolved to absolute before being passed to
opencode. Previously a relative seed path resolved against the *server's* launch
directory, not the target repo's `--dir` — silent-failed the instant the warm server
(reused across projects, by design) was started from anywhere else. If this recurs on
an older checkout, update `bin/delegate.mjs`.

**Orphaned processes after a timeout.**
Windows does not kill a child's descendants with the parent. The dispatcher uses
`taskkill /T` on timeout, but if one escapes:

```bash
tasklist /FI "IMAGENAME eq opencode.exe"
taskkill /F /T /PID <pid>
```

Two live sessions racing the same working directory produce genuinely confusing diffs, so
clear strays before relaunching. `npm run doctor` counts them.

**The wrong model ran.**
`-m` is honoured — if an unexpected model appears, the dispatcher was not the caller, or
`--model` was passed explicitly. `gpt-5.6-luna` specifically is the default that applies
when no model is resolved.

**Scope violations on every run.**
Check the `--scope` globs. Supported: `**` (any depth), `*` (one segment), `?` (one
char), forward slashes only.

## Rolling back

The installer backs up whatever it replaces:

```
~/.agent-system/backups/<timestamp>/
```

Original layout is preserved — copy the tree back over `~` to restore. `--dry-run` shows
what a deploy would touch before it touches it.

## Changing the system

The repo is the source of truth; the deployed copies are outputs. Edit here, re-run
`node scripts/install.mjs`, then `npm run doctor`. Never edit `~/.config/opencode/` or
`~/.claude/` directly — the next install overwrites it.
