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

**Frontend work** avoids the current generative-design defaults: cream-and-serif with a
terracotta accent, near-black with one acid accent colour, decorative numbered section
markers where the content is not genuinely a sequence. Spend boldness on one element and
keep the rest restrained. Watch for CSS specificity collisions between type-based and
element-based selectors fighting over spacing.

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
