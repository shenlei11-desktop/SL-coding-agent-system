# Writing a request the orchestrator can act on without exploring

The orchestrator burns your context window when it has to *discover* what you could have
told it. A request that already carries the four fields below collapses its job to:
classify -> paste -> dispatch -> verify. No codebase spelunking, no option surveys, no
plan written in prose first.

## The four fields

1. **What, and what "done" looks like.** The change plus its acceptance test.
   *"Add retry with backoff to the HTTP client; a test that simulates two 503s then a 200
   passes."*
2. **The files.** Name them. `src/http/client.ts`, test in `tests/http/client.test.ts`.
   Every file the orchestrator has to *find* is a read charged to your window, and it
   usually has to read the whole thing to be sure it found the right one.
3. **The anti-pattern, if you know one.** *"Don't add a dependency for this."* *"Don't
   replace the existing streaming read."* A named prohibition is worth more than any
   amount of the orchestrator reasoning about what you probably meant — and it maps
   straight to `--anti`.
4. **Tier hint, if you have one.** 1 = docs/boilerplate, 2 = normal fix (the default),
   3 = multi-file refactor, security, or financial logic. Omit if unsure; the orchestrator
   will pick.

## Template

Keep this next to the repo and fill it in:

    Task:  <what to change> -- done when <acceptance test>.
    Files: <path>, <path>
    Don't: <anti-pattern>          # omit the line if none
    Tier:  <1|2|3>                # omit the line if unsure

## Example

Weak — forces the orchestrator to go read the parser and its tests to find out what you
mean, then guess the acceptance criteria:

> can you make the parser handle the new date format

Strong — dispatches on the first turn:

> Task:  `src/parser.py` should accept ISO-8601 dates with a timezone offset
>        (`2026-01-01T00:00:00+08:00`), not just naive ones -- done when
>        `tests/test_parser.py::test_tz_offset` passes.
> Files: src/parser.py, tests/test_parser.py
> Don't: pull in dateutil; the stdlib handles this now.

## Why this works

The `delegate` skill already removes the *delegate's* exploration with `--seed`. These
fields do the same thing one level up — they remove the *orchestrator's* exploration,
which is the expensive one, because it runs in the metered context window rather than the
delegate's flat-rate one. See the "Conduct" rules in `~/.claude/CLAUDE.md`.
