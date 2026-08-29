# SL-coding-agent-system

An orchestrator/delegate coding system that separates planning from implementation.

## What it is and why

- **Orchestrator — Claude Code.** Plans, scopes, routes, and verifies. Never edits application source directly.
- **Delegate — opencode CLI.** Receives scoped tasks and writes the actual code.

**Why this shape:** Claude's context window is the metered resource; the delegate's token spend is flat-rate. A well-scoped delegation costs the orchestrator roughly 600-1,500 tokens regardless of how much work the delegate performed. The same task done directly would spend the orchestrator's budget on every file read and every line generated.

Setting this up on a second device on the same opencode-go subscription? See
[docs/MULTI-DEVICE.md](docs/MULTI-DEVICE.md) — the steps below cover a single machine.

## Installation

### Prerequisites

- **Node.js ≥ 20** — `node --version` to check.
- **opencode CLI**, installed globally:
  ```bash
  npm i -g opencode-ai
  ```
- **A GitHub account with access to this repo**, if cloning it fresh (see
  [second-device setup](docs/MULTI-DEVICE.md) if you're bringing this to another machine).
- **An opencode-go account** — the flat-rate subscription this system dispatches against.

### Steps

**1. Get the repo and check it out on the working branch.**
```bash
git clone https://github.com/shenlei11-desktop/SL-coding-agent-system.git
cd SL-coding-agent-system
git checkout feat/agent-system
```

**2. Log into opencode-go.**
```bash
opencode auth login
```
Follow the prompt and select the `opencode-go` provider. This is a one-time,
per-machine step — credentials live in opencode's own local auth store, never in
this repo.

**3. Deploy the config.**
```bash
node scripts/install.mjs
```
Writes `~/.config/opencode/opencode.jsonc` (the tier/role agents) and `~/.claude/`
(the orchestrator's `CLAUDE.md` and the `classify`/`delegate`/`verify` skills),
backing up anything it replaces to `~/.agent-system/backups/`. Add `--dry-run` first
if you want to see what it would touch before committing to it.

**4. Verify.**
```bash
node scripts/doctor.mjs
```
Should report `0 failures`. It checks the opencode binary resolves, every configured
agent is present, the tier registry's models actually exist in the live catalog, and
that no orchestration protocol has leaked into the delegate-visible instruction file
(see [Verified findings](#verified-findings) below for why that last check exists).

**5. Start the warm server (optional, but the single biggest latency win available).**
```bash
npm run serve:start
```
Cold start is a one-time >2 minute cost; every dispatch after that against a warm
server runs in ~7s of fixed overhead. `npm run serve:stop` / `npm run serve:status`
manage it. `bin/delegate.mjs` auto-attaches whenever a server is running — nothing
else to configure.

You're set up. See [Running the system](#running-the-system) below for how to
actually dispatch a task, or open a project with Claude Code and just describe what
you want — the `delegate` skill routes it through this system automatically once
step 3 has deployed it globally. Phrasing the request in the four-field shape from
[docs/REQUEST-BRIEF.md](docs/REQUEST-BRIEF.md) keeps the orchestrator from spending
context on exploration it doesn't need to do.

## Repository layout

```
bin/          # delegate.mjs (dispatcher), serve.mjs (warm server)
scripts/      # install.mjs, doctor.mjs, ledger.mjs
config/       # opencode.jsonc (agents), tiers.json (model routing)
claude/       # CLAUDE.md and skills, deployed to ~/.claude
templates/    # prompt templates, plus project scaffolding
docs/         # design docs and verified findings
```

Deployed by `scripts/install.mjs` to `~/.config/opencode/` and `~/.claude/`. State —
rotation, cost ledger, run logs — lives in `~/.agent-system/`, deliberately outside
`~/.claude/`, because opencode ingests instruction files from there.

## The three tiers

Each tier is a real opencode agent owning its own system prompt, permissions, and step
cap. Rotation swaps the model *within* a tier, spreading flat-rate usage across the plan.

Routing lives in [`config/tiers.json`](config/tiers.json). Models are split into a
`rotation` pool and an `unverified` pool: placements with no benchmark grounding are
excluded from rotation unless `--include-unverified` is passed, so guessed rankings never
silently do real work.

| Tier | Agent | Intended use |
|------|-------|--------------|
| 1 | `t1-scribe` | Docs, comments, copy, formatting, boilerplate. No logic changes. |
| 2 | `t2-build` | Typical fixes and small features. 1–3 files. The default. |
| 3 | `t3-architect` | Multi-file refactors, security or financial logic, tier-2 failures. |

Two role agents sit outside the tiers: `reviewer` (read-only second opinion, never given
the implementer's own model) and `oneshot` (`steps: 1`, no tool loop, for pure text
transforms).

Tier 3 is not a quality upgrade for a badly specified task. Escalate the specification
first — see the `classify` skill.

## Useful commands

- `npm run delegate` — dispatch a task to the delegate
- `npm run verify` — run the landing gate (scope, test-tampering, typecheck, lint, tests) on a repo
- `npm run ledger` — view session cost ledger
- `npm test` — the system's own unit tests
- `npm run serve:stop` / `npm run serve:status` — manage the delegate server
- `npm run install:dry` — preview what the installer would change

## Verified findings

The design rests on facts checked against this machine, not assumptions. See
[docs/CONTEXT-BRIEF.md](docs/CONTEXT-BRIEF.md) for the full record. In brief:

- `-m` **does** pin the model. Session records show requested and used models always
  matching; `gpt-5.6-luna` is the sticky default when `-m` is absent.
- A warm invocation costs **~7s**, not the ~2min once assumed. Only cold start is slow.
- opencode **reads `~/.claude/CLAUDE.md`**. Orchestration protocol placed there gets
  followed by the delegate — which previously sent it hunting for a rotation state file
  outside its working directory, hitting a permission gate that aborted the run.
- Setting a tool `permission` to `"deny"` **hangs the run**. Cap `steps` instead.
- `steps: 1` yields a genuine tool-free single-shot completion.

## Running the system

Dispatch is a single command; it prints one compact JSON result rather than a transcript.

```bash
node bin/delegate.mjs --tier 2 --template implement \
  --task  "<what to do and what done looks like>" \
  --scope "src/parser.py,tests/test_parser.py" \
  --seed  "src/reader.py" \
  --anti  "Do not add a new dependency"
```

`--scope` is enforced: tracked files changed outside it are reverted automatically
(`--keep-strays` to opt out), untracked ones reported in `strays_kept`. `--seed` names
files up front so the delegate skips exploration round-trips — the cheapest latency win
available.

A repo can carry its own `.agent-system.json` (tier, model, scope, baseline
anti-patterns) so dispatches into it are standard without re-typing the flags — see
[templates/project/agent-system.json](templates/project/agent-system.json). Two
dispatches with overlapping scopes in one working directory are refused rather than left
to race the tree.
