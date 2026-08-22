# SL-coding-agent-system

An orchestrator/delegate coding system that separates planning from implementation.

## What it is and why

- **Orchestrator — Claude Code.** Plans, scopes, routes, and verifies. Never edits application source directly.
- **Delegate — opencode CLI.** Receives scoped tasks and writes the actual code.

**Why this shape:** Claude's context window is the metered resource; the delegate's token spend is flat-rate. A well-scoped delegation costs the orchestrator roughly 600-1,500 tokens regardless of how much work the delegate performed. The same task done directly would spend the orchestrator's budget on every file read and every line generated.

## Quick start

```bash
# 1. Deploy config and scripts
node scripts/install.mjs

# 2. Start the delegate server for session reuse
npm run serve:start

# 3. Verify the environment
npm run doctor
```

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
- `npm run ledger` — view session cost ledger
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

`--scope` is enforced: files changed outside it are reported, and reverted with
`--revert-strays`. `--seed` names files up front so the delegate skips exploration
round-trips — the cheapest latency win available.
