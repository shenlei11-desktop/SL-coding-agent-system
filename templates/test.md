# Test-writing task

{{TASK}}

{{SEED}}

{{SCOPE}}

{{ANTI}}

## How to approach this

1. Read the code under test and the existing test files listed above.
2. Match the existing test style exactly — same framework, same fixture pattern, same
   naming convention, same assertion style. Do not introduce a different test library.
3. Test observable behaviour through the public interface. Do not reach into private
   state to make a test pass.

## What to cover

- The normal path, with realistic inputs.
- Boundary conditions: empty, zero, one, maximum, and the value just past a limit.
- Error paths: each way the code is documented or designed to fail, asserting the
  specific failure, not merely that something was raised.

## Definition of done

- Tests fail if the behaviour they describe is broken. A test that passes against a
  deliberately broken implementation is worthless — check yours would actually catch it.
- No test asserts something the code does not promise.
- No sleeps, no dependence on wall-clock time, no dependence on test execution order,
  no network calls.
- Every file you touched is in the allowed list above.
