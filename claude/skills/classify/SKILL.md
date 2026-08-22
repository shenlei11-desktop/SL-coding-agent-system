---
name: classify
description: Decide how to route a coding task before dispatching it — whether it is safe to delegate from a prose spec, needs a skeleton written first, or must be written directly. Use before any delegation, and whenever a delegated attempt came back with the wrong approach rather than merely buggy code.
---

# Classify a task before dispatching it

This gate exists because the expensive failure is not a delegate writing buggy code — that
gets caught by tests. The expensive failure is a delegate confidently building the *wrong
thing*, which costs a full round-trip and is only visible on review.

Run this before dispatching. It takes seconds and it decides the template.

## The decision

Ask one question: **is there a common, generic pattern that a model might reach for
instead of the correct one here?**

Training priors beat prose specs. Two models at different capability tiers have already
independently produced the same wrong artefact from a detailed spec with signatures.
Escalating tier does not fix this — a stronger model has the same prior.

### Route A — loose-spec safe → `--template implement`

The task has no strong competing prior, or the obvious approach is the correct one.

- Documentation, comments, copy.
- Tests written against an established pattern already in the repo.
- A new component matching existing components.
- Boilerplate, config, straightforward CRUD.
- A bug fix where the fix is local and the surrounding code shows the way.

Dispatch normally at the appropriate tier.

### Route B — competing prior exists → `--template skeleton`

The correct approach is real but uncommon, and something more familiar looks plausible.

Signals:
- Wrapping a CLI, subprocess, or unusual transport where an HTTP client is the common shape.
- Mirroring an existing in-repo module rather than implementing a general interface.
- A protocol or format handled a specific way here (streaming vs batch, NDJSON vs JSON).
- Anything where you can already name what the model will wrongly reach for.
- A previous attempt came back with a *different design*, not merely bugs.

**Write the skeleton yourself**: exact signatures, imports, control flow, and a comment in
each body saying what it must do. Delegate only the bodies. This removes the token path to
the wrong pattern instead of arguing against it.

Always pass `--anti` naming the specific wrong pattern. Naming the exact anti-pattern you
have seen — not a generic "be careful" — measurably reduces recurrence. Generic caution
does not work; a named prohibition does.

### Route C — precision-critical → write directly

Delegation is not appropriate at all.

- Interface code where exact content is the whole deliverable.
- A task where Route B has already failed.
- Security, auth, or financial logic where a subtle wrong choice is costly and review is
  harder than writing it.
- Anything under ~30 lines where specifying it precisely costs more than writing it.

Write it, then optionally delegate a `--role reviewer` pass for a second opinion.

## After classifying

| Route | Template | Also do |
|---|---|---|
| A | `implement` | Set `--scope`. Seed the files with `--seed`. |
| B | `skeleton` | Write the skeleton first. Always set `--anti`. |
| C | none | Write directly; consider a reviewer pass. |

Route B is the one that gets skipped under time pressure and the one that pays for itself
most. If you can name the wrong pattern in advance, you are in Route B — take it.
