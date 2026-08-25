# Fill-in task — the structure is already decided

This task uses skeleton-first delegation. The interface, the control flow, and the
approach have already been chosen and are given to you below. **Your job is to fill in
the bodies, not to design anything.**

This exists because a correct-but-uncommon approach loses to a more common one when a
model is asked to design from a prose spec. The skeleton removes that choice.

{{TASK}}

{{SEED}}

{{SCOPE}}

{{ANTI}}

## Rules specific to this task type

- **Do not change any signature.** Names, parameters, return types, and ordering are
  fixed. If a signature looks wrong, implement it as given and say so at the end.
- **Do not add, remove, or reorder functions, classes, or methods.**
- **Do not substitute a different approach**, however familiar the alternative looks.
  If the skeleton calls a subprocess, do not replace it with an HTTP client. If it parses
  a stream, do not replace it with a single parse. The structure is the specification.
- **Do not add dependencies.** Use what the skeleton and the existing imports already use.
- Where the skeleton has a comment describing what a body must do, implement exactly that.

## Definition of done

- Every marked body is implemented; no `pass`, `TODO`, `NotImplementedError`, or stub left.
- The skeleton's structure is byte-for-byte intact apart from the filled bodies.
- Every file you touched is in the allowed list above.

If a body genuinely cannot be written as specified, leave it as given, and explain the
obstacle at the end. Do not silently redesign around it.
