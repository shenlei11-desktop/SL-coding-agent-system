# Onboarding a repo to the agent system

The global install (`~/.claude/` skills + CLAUDE.md, `~/.config/opencode/`, the commit
hook) is machine-wide and already done. Per repo it is three files once, then the loop.

## The prompt

From inside the target repo, launch `claude` and say:

> Set up this repo for the agent system — follow `ONBOARD-REPO.md` in the SL-coding-agent-system repo.

(point it at the path if it asks — e.g. `~/OneDrive/Desktop/SL-coding-agent-system/docs/ONBOARD-REPO.md`)

Everything below is the procedure the orchestrator then runs. `<system>` is wherever
SL-coding-agent-system is cloned.

---

## What the orchestrator does

### 0. Preconditions

- Confirm the working directory is the target repo and it is a git repo.
- Confirm it is **not** on `main` / `master`. If it is, ask the user for a branch name
  and `git checkout -b rework/<name>`.
- Confirm the warm server: `node <system>/bin/serve.mjs status`. If down,
  `node <system>/bin/serve.mjs start` (once per working session, not per repo).

### 1. Draft `AGENTS.md` — read by opencode, so it must be right

```bash
cp <system>/templates/project/AGENTS.md ./AGENTS.md
```

Fill it by inspecting the repo — do not ask the user what a `grep` would tell you:

- **Stack** — language/runtime/framework from file extensions, `package.json`,
  `pyproject.toml`, `go.mod`.
- **Commands** — the *real* ones. Read `package.json` `scripts`, a `Makefile`, or
  `pyproject.toml`. These feed both the delegate and `verify.mjs`, so a wrong command
  costs a round-trip. Fill `install` / `test` / `lint` / `typecheck` / `run`.
- **Layout** — the top-level directories that matter.
- **Conventions** — skim 3–5 representative source files. Note only what a competent
  stranger would get wrong. Delete the rest; a long file is skimmed, not followed.
- **Patterns to mirror** — name one real example file per kind (route, client, test, …).
- **Output conventions** — keep the lines that apply (UI, or structured docs/data),
  delete the others.

Keep orchestration protocol **out** of it. Show the user the draft and take edits.

### 2. Draft `.agent-system.json` — read by delegate.mjs and verify.mjs

```bash
cp <system>/templates/project/agent-system.json ./.agent-system.json
```

Set:

- `tier` — `2` for a normal codebase; `1` if it is mostly docs/prose; `3` if the rework
  is mostly architecture or security/financial logic.
- `scope` — the globs holding changeable code, e.g. `["src/**", "tests/**"]`.
- `anti` — baseline prohibitions: never touch `README.md`, `CHANGELOG.md`, lockfiles, or
  CI config unless a task names them.
- `model` — pin one only with a reason (e.g. a docs-heavy repo → `"glm-5.2"`); otherwise
  omit and let rotation run.

Show the user, take the nod.

### 3. Sanity check — no opencode spend

```bash
node <system>/bin/delegate.mjs --task noop --dir . --dry-run
```

Confirm the result shows `repo_config: ".agent-system.json"` and the resolved
`tier` / `scope` / `model` match the file.

### 4. Optional — CI and the verify gate

- If the repo has no CI, offer `<system>/templates/project/ci-node.yml` or `ci-python.yml`
  → `.github/workflows/ci.yml`.
- Run `node <system>/scripts/verify.mjs --dir .` once with no pending changes. Every gate
  should be `pass` or `skip`. A `skip` on `tests` means there is no runner — flag that to
  the user before any real work; the house rule needs a test that fails without the change.

### 5. Commit the config — and only the config

```bash
git add AGENTS.md .agent-system.json .github/workflows/ci.yml   # whichever exist
git commit -m "Add agent-system config for this repo"
```

Do not stage anything else. Do not push. Committing config so every machine and session
gets the same routing is the point.

---

## Then: the per-task loop

`classify` → state the dispatch spec, wait for a one-line yes on non-trivial work →
`node <system>/bin/delegate.mjs …` → `node <system>/scripts/verify.mjs --dir .` →
read the diff for silent gaps → commit on the branch → `/clear` (the hook reminds you).

For a larger rework: split into scoped tasks, one `--scope` and one commit each; reuse
`--session <id>` for a follow-up on the same area; switch to `classify` Route B (you write
the skeleton) if a run comes back with the wrong *approach* rather than just bugs. Land to
`main` only after `verify.mjs` is green; the push/PR is the user's.
