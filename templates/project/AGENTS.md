# AGENTS.md — <project name>

Copy this to a project root and fill it in. This file is read by the **delegate**
(opencode) as an instruction source, so everything here should be something you want an
implementation agent to follow. Keep orchestration protocol out of it — that belongs to
the orchestrator and causes real failures when an implementation agent tries to follow it.

Keep this file short. A long instruction file is skimmed; a short one is followed.

## What this project is

<One paragraph. What it does, who uses it, what the core domain objects are.>

## Stack

- Language / runtime:
- Framework:
- Test runner:
- Package manager:

## Commands

The real ones — an agent will run these, so wrong commands cost a full round-trip.

```bash
<install>      # e.g. npm ci  /  pip install -e ".[dev]"
<test>         # e.g. npm test  /  pytest -q
<lint>         # e.g. eslint .  /  ruff check .
<typecheck>    # e.g. tsc --noEmit  /  mypy .
<run>          # e.g. npm run dev
```

## Layout

```
src/        <what lives here>
tests/      <mirrors src/ structure>
docs/
scripts/
config/
```

## Conventions that are not obvious from reading the code

List only things a competent stranger would get wrong. Do not restate general good
practice — it is already known and it dilutes the rules that matter.

- <e.g. All external calls go through `src/clients/`; never call requests/fetch directly.>
- <e.g. Errors surface as `DomainError` subclasses; never raise bare Exception.>
- <e.g. Config is read once at startup into `settings`; never read env vars inline.>

## Patterns to mirror

When adding something of a given kind, copy the structure of the named file rather than
designing fresh. This is the most valuable section — it is what stops an agent reaching
for a generic pattern over the project's specific one.

| Adding a... | Mirror |
|---|---|
| <API route> | `src/routes/<example>` |
| <client> | `src/clients/<example>` |
| <test> | `tests/<example>` |

## Hard rules

- Do not commit, push, or delete files.
- Do not add a dependency without being asked.
- Do not modify lockfiles, notebook metadata, or CI config unless the task names them.
- Do not weaken or delete a test to make a suite pass.
- Change only the files the task names.
