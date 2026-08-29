---
name: delegate
description: Dispatch a scoped implementation task to the opencode delegate and verify the result. Use for any code change that is not precision-critical — the orchestrator plans and verifies, opencode writes. Covers tier routing, latency controls, scope enforcement, and the verification loop.
---

# Delegate an implementation task

Implementation goes to opencode. This skill covers dispatching one task and verifying it.

Run `classify` first if you have not already — it decides the template and whether to
delegate at all.

## Dispatch

```bash
node <system>/bin/delegate.mjs \
  --tier 2 \
  --template implement \
  --task "<what to do, and what done looks like>" \
  --scope "src/parser.py,tests/test_parser.py" \
  --seed  "src/reader.py" \
  --anti  "Do not add a new dependency
Do not replace the existing streaming read with a single read" \
  --dir "<repo path>"
```

The command prints one compact JSON object. Read that. **Never read the NDJSON log into
context** — it duplicates whole file contents per tool call and will flood the window.
The log path is in the result if a failure genuinely needs investigating; grep it for a
specific field rather than reading it.

## The dispatch is standardised per repo

A target repo may carry `.agent-system.json` at its root setting the defaults for that
repo — `tier`, `model`, `scope`, `seed`, `template`, and a baseline `anti` list. When it
exists you pass only `--task` (plus a task-specific `--scope`/`--anti` if this task is
narrower than the repo default). CLI flags override the file; `--anti` adds to its
baseline rather than replacing it; `--no-config` ignores it. `--dry-run` shows the
resolved values and which config file applied. Seed a new repo from
`templates/project/agent-system.json`.

## Reading the result

- `touched` — paths the run actually edited, **including files that were already dirty**
  when it started. `changed` only lists newly-dirty paths, so on an uncommitted tree it
  can be empty while real work happened. Judge "did it do anything" by `touched`.
- `out_of_scope` / `reverted` / `strays_kept` — files changed outside `--scope`. Tracked
  strays are reverted automatically; `strays_kept` lists untracked ones still on disk for
  you to remove. Pass `--keep-strays` only when you want to inspect them first.
- An overlapping dispatch in the same working directory is refused up front (`error:
  "a dispatch with an overlapping scope is already active"`). Run one task at a time per
  repo, or give the parallel runs genuinely disjoint `--scope`s.

## Getting latency down

Latency is the main complaint about this loop, and most of it is avoidable. In order of
payoff:

1. **`--seed` the relevant files.** Every file the delegate has to *find* costs a
   glob/grep round-trip before any work starts. Naming files up front removes those
   steps entirely. This is the single biggest win and it is nearly free — you almost
   always know which files matter.
2. **`--session <id>`** for a follow-up on the same area. Reuses the delegate's built-up
   context instead of re-exploring. The previous result's `session` field is the id.
3. **Warm server.** `npm run serve:start` once per working session; the dispatcher
   auto-attaches and process boot leaves the critical path. Cold start is genuinely
   slow (>2 min once); warm calls are ~7s of fixed overhead.
4. **Right-size the tier.** Tier 3 is slower and is not more likely to get a
   loose-spec task right — that is a prior problem, not a capability problem.

Independent tasks can be dispatched concurrently — separate scopes, one call each.

## Tiers

| Tier | Use for |
|---|---|
| 1 | Docs, comments, copy, formatting, boilerplate. No logic. |
| 2 | Typical fixes and small features. 1–3 files. The default. |
| 3 | Multi-file refactors, security or financial logic, or a task tier 2 already failed. |

Tier 3 is not a quality upgrade for a badly specified task. Escalate the *specification*
first — usually to `--template skeleton` — before escalating the tier.

## Verify — always, before reporting done

The dispatcher enforces scope and reports what changed. It does **not** tell you the code
is correct. Complete the loop:

1. **Check the result JSON.** `ok: false` means it failed, timed out, or left an
   untracked stray (`strays_kept`). Tracked out-of-scope edits are already reverted;
   delete anything in `strays_kept` yourself. `touched: []` on an `ok` run means it
   wrote nothing — treat that as a red flag, not a pass.
2. **Read the diff.** `git diff --stat` first; the full diff only for the files that
   matter. This is the step that catches silent partial completion.
3. **Run the tests.** House rule: a change is not done until tests pass. This is the real
   correctness gate — the diff only shows what changed, not whether it works.
4. **Optionally review.** For anything non-trivial, `--role reviewer --template review`
   with `--not-model <implementer's model>` gets a second model with different priors
   looking at the diff. Cheap, and it catches what the implementer's own prior hid.

## When a run comes back wrong

Do not re-run the same prompt. Diagnose which failure it is:

- **Wrong approach entirely** → a prior problem. Switch to `--template skeleton` and add
  `--anti` naming exactly what it did wrong. Do not just escalate the tier.
- **Right approach, buggy** → tighten the task's acceptance criteria and re-dispatch at
  the same tier, seeding the files it got wrong.
- **Out of scope** → tighten `--scope`. Tracked strays self-revert; if the same file
  keeps getting hit, name it in `--anti`.
- **Overlap refused** → another dispatch is live in that repo. One task per repo at a
  time, or give the parallel runs disjoint `--scope`s.
- **Timed out** → the task is too big. Split it.
- **Incomplete but honestly reported** → dispatch the remainder as a follow-up with
  `--session` so it keeps its context.

## Never delegate

`git push`, force operations, file deletions, or anything touching credentials. Those stay
with the user.
