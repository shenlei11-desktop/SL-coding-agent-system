---
name: verify
description: Run the correctness gate on a task branch before it reaches main — scope check, tests, lint, typecheck, optional second-model review, then merge. Use when a delegated change is complete and needs to land, or whenever asked whether a change is ready.
---

# Verify a change before it lands

House rule: `main` is only reached by merging something already verified. This skill is
that verification. Run it on the task branch.

Order matters — cheapest and most specific first, so a failure costs the least time.

## 1. Scope

```bash
git status --porcelain
```

Every changed file should be one the task called for. Check the *full* list, not just the
file you expected — a stray edit to notebook metadata or a lockfile is easy to miss and
has happened before. Revert anything unrelated: `git checkout -- <path>`.

## 2. Read the diff

`git diff --stat` for shape, then the full diff for files carrying real logic. You are
looking for silent partial completion — a function that returns a plausible value without
doing the work, an error path that swallows, a TODO left behind. This is the failure the
automated gates below will *not* catch.

## 3. Static gates

Run whatever the repo actually has. Do not invent commands — check `package.json`
scripts, `pyproject.toml`, or the CI workflow for the real ones.

- **Typecheck** — `tsc --noEmit`, `mypy`, `pyright`. Fastest real signal.
- **Lint** — `eslint`, `ruff`, `flake8`.

Fix or re-dispatch failures. Never silence a rule to get past it.

## 4. Tests — the actual gate

```bash
npm test        # or: pytest, pnpm test, etc.
```

A change is not done until these pass. Two things to confirm beyond a green run:

- New behaviour has a test that would **fail without the change**. If it passes against
  the old code, it tests nothing.
- No existing test was weakened, skipped, or deleted to get green. Check the diff for
  changes to test files you did not ask for.

## 5. Second-model review — optional, worth it for non-trivial changes

```bash
node <system>/bin/delegate.mjs --role reviewer --template review \
  --not-model <implementer's model> \
  --task "Review this diff against these criteria: <criteria>" \
  --seed "<changed files>" --dir "<repo>"
```

A reviewer with different training priors catches what the implementer's own prior hid.
Read its `VERDICT` line and its findings; a finding without a concrete failure case is a
style opinion and can be ignored.

## 6. Land it

Only after the above passes:

```bash
git add <specific paths>        # never -A; stage what you verified
git commit -m "<what changed and why>"
```

Then merge to `main` — or push the branch and open a PR if the repo has branch protection
and CI. Let CI be the final gate rather than duplicating it locally.

**Never** `git push`, force-push, or delete branches without the user asking. Committing
on the task branch is fine; anything that leaves the machine or rewrites history is theirs.

## Reporting

Say plainly what passed and what did not. If tests fail, show the failing output rather
than summarising it as "some failures". If you skipped a gate because the repo does not
have it, say which one and why — do not imply coverage that does not exist.
