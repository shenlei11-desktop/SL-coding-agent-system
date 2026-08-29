---
name: verify
description: Run the correctness gate on a task branch before it reaches main — scope check, test-tampering scan, typecheck, lint, tests via scripts/verify.mjs, then the diff read and optional second-model review, then merge. Use when a delegated change is complete and needs to land, or whenever asked whether a change is ready.
---

# Verify a change before it lands

House rule: `main` is only reached by merging something already verified. This skill is
that verification. Run it on the task branch.

## 1. The mechanical gates — one command

```bash
node <system>/scripts/verify.mjs --dir "<repo>" --scope "<same globs you dispatched with>"
```

It runs, in order, stopping at the first hard failure, and prints one JSON object:

| gate | fails on | notes |
|---|---|---|
| `scope` | a changed file outside `--scope` | pulls `--scope` from the repo's `.agent-system.json` if you omit it |
| `test_tamper` | — (warns) | flags `.skip`/`.only` added, test declarations or assertions removed. `--strict-tests` makes it fail. |
| `typecheck` | the repo's `typecheck` script / `mypy` | `skip` if the repo has neither |
| `lint` | the repo's `lint` script / `ruff` | `skip` if neither |
| `tests` | the repo's `test` script / `pytest` non-zero | `fail` if there is no runner at all, unless `--allow-no-tests` |

Read `ok`, `failed`, `warned`. A failing gate carries a `tail` of its output and a
`next` hint. Do not paper over a failure — re-dispatch with the failing output seeded,
never loosen a rule or a test to get past it. A `test_tamper` warning is not optional to
look at: open those files and confirm the change earns its green.

## 2. Read the diff — the part no script does

`git diff --stat` for shape, then the full diff for files carrying real logic. You are
looking for silent partial completion: a function returning a plausible value without
doing the work, an error path that swallows, a TODO left behind, a new test that would
pass against the *old* code and therefore tests nothing.

## 3. Second-model review — optional, worth it for non-trivial changes

```bash
node <system>/bin/delegate.mjs --role reviewer --template review \
  --not-model <implementer's model> \
  --task "Review this diff against these criteria: <criteria>" \
  --seed "<changed files>" --dir "<repo>"
```

A reviewer with different training priors catches what the implementer's own prior hid.
Read its `VERDICT` line; a finding without a concrete failure case is a style opinion.

## 4. Land it

Only after 1–3 pass:

```bash
git add <specific paths>        # never -A; stage what you verified
git commit -m "<what changed and why>"
```

Then merge to `main`, or push the branch and open a PR if the repo has branch protection
and CI — let CI be the final gate rather than duplicating it locally.

**Never** `git push`, force-push, or delete branches without the user asking. Committing
on the task branch is fine; anything that leaves the machine or rewrites history is theirs.

## Reporting

Say plainly what passed and what did not. If a gate failed, show its `tail`, not a
paraphrase. If `verify.mjs` marked a gate `skip`, say which and why — do not imply
coverage that does not exist.
