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

1. **Check the result JSON.** `ok: false` means it failed, timed out, or went out of
   scope. `out_of_scope` lists strays — re-run with `--revert-strays` or revert manually.
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
- **Out of scope** → tighten `--scope`; add `--revert-strays`.
- **Timed out** → the task is too big. Split it.
- **Incomplete but honestly reported** → dispatch the remainder as a follow-up with
  `--session` so it keeps its context.

## Never delegate

`git push`, force operations, file deletions, or anything touching credentials. Those stay
with the user.
