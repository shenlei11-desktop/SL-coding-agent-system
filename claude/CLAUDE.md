# CLAUDE.md (global)

> **If you are not Claude Code, ignore the "Orchestration" section below.**
> Verified 2026-08-22: the opencode CLI ingests this file as an instruction source.
> The house rules here apply to any tool working on this machine's code. The
> orchestration section describes how a *different* program dispatches work, and
> following it as an implementation agent causes real failures — it previously caused
> delegates to hunt for a rotation state file outside their working directory, hit a
> permission gate, and abort mid-run. If you are executing a coding task: do the task.
> Do not delegate it onward. Do not look for a rotation file.

## House rules

These apply to all code on this machine, whoever is writing it.

**Languages.** Python, JavaScript, TypeScript.

**Tests gate changes.** A change is not done until the relevant tests pass. New behaviour
needs a test that would fail without it. Do not weaken or delete a test to make a suite
go green — if a test is genuinely wrong, say so explicitly rather than quietly editing it.

**Branching.** Never commit directly to `main`. Work happens on a task branch; `main` is
only reached by merging something already verified. Never run `git push`, `git reset
--hard`, force operations, or file deletions as part of an automated task.

**Match the surrounding code.** Follow the patterns actually present in the file and its
neighbours — imports, error handling, naming, test style — even when a different approach
is more common in general. When asked to mirror an existing module, mirror it literally.

**Scope.** Change only what the task calls for. No opportunistic reformatting, no tidying
adjacent code, no touching lockfiles, dependency manifests, or notebook metadata unless
the task names them.

**Frontend work.** Classify the surface first — marketing/portfolio, product app, or
tool/dashboard — and apply the matching discipline. The `frontend` skill carries the full
version; `templates/frontend.md` is the delegate-facing condensed form (`--template
frontend`). Non-negotiables on any surface: one theme, one accent colour, one
corner-radius system, audited across the whole page; WCAG AA contrast on every text,
control, and focus ring; `prefers-color-scheme` dark mode; `prefers-reduced-motion`
honoured; empty / loading / error states, not just the happy path; real content, never
CSS art or `<div>` fake screenshots; no em-dashes in visible copy. Avoid the tired
defaults: cream-and-serif with a terracotta accent, near-black with one acid accent,
`Inter` as the default sans, AI-purple glow, three identical feature cards, an eyebrow
above every heading, decorative numbered markers on non-sequential content. Spend boldness
on one element, keep the rest restrained. Watch for CSS specificity collisions between
type-based and element-based selectors fighting over spacing. Match the target repo's
existing stack — do not introduce a framework or build step a project does not already
have.

**Repository layout.** `src/`, `tests/`, `docs/`, `scripts/`, `config/`,
`.claude/skills/`, `.opencode/`.

---

## Orchestration — Claude Code only

Implementation is delegated to the opencode CLI rather than written directly. The full
protocol, routing rules, and verification loop live in the `delegate` skill — invoke it
rather than improvising a dispatch.

Standing exception: write code directly when correctness depends on exact content and a
loose specification has already proven unreliable for that task. Use the `classify` skill
to make that call before dispatching, not after a wasted round-trip.

### Conduct

The metered resource is this context window, not the delegate's flat-rate spend. Keep the
orchestrator's own loop cheap:

- **Triage before exploring.** The first response to a coding request is one line: route
  (A/B/C) · tier · the files that will be in `--scope` · the anti-pattern if you can name
  one. Classification runs on the request text and your priors — do not read repo files
  to produce it.
- **Bounded reading.** Read only files you will name in `--scope` / `--seed`. If the
  request names them, read none. If about three files in you still cannot scope the task,
  stop and ask one question rather than keep digging.
- **Delegate exploration; do not perform it.** When a task cannot be scoped without first
  understanding the code — how a feature works, where every call site is, why something
  breaks — that investigation is itself a delegate job, not something to do by reading
  widely in this window. Dispatch a recon run (a tier agent, `--scope` limited to a
  single scratch notes file, `--task` = "investigate X; write findings — entry points,
  call chain, files:lines, gotchas — to `<file>`; change nothing else"), read that one
  file back, then plan from it. The three-files-then-ask limit above is the ceiling on
  what the orchestrator reads directly; past it, the answer is a recon dispatch. This is
  the default, not something the user has to ask for.
- **No option surveys.** Pick an approach, state it in a sentence, proceed. Surface a
  choice to the user only on Route C or a genuinely ambiguous spec.
- **The plan is the dispatch brief.** Emit the `--task` / `--scope` / `--seed` / `--anti`
  values, not prose describing them.
- **Report deltas.** No task restatement, no narration of intended steps. On completion:
  the verify outcome and `git diff --stat`.
- **One task, one context.** `/clear` after a task branch lands; the loop keeps no state
  between tasks.
