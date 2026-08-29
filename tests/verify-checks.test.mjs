import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTestPath, parseUnifiedDiff, scanTestTamper } from '../bin/lib/verify-checks.mjs';

// --- isTestPath --------------------------------------------------------------

test('isTestPath: recognises the usual test locations', () => {
  for (const p of [
    'tests/test_parser.py', 'src/__tests__/foo.js', 'a/b/foo.test.ts',
    'a/foo.spec.tsx', 'pkg/thing_test.go', 'conftest.py', 'spec/models/user_spec.rb',
  ]) assert.equal(isTestPath(p), true, p);
});

test('isTestPath: leaves production paths alone', () => {
  for (const p of ['src/parser.py', 'lib/http/client.ts', 'app/testimonials.js']) {
    assert.equal(isTestPath(p), false, p);
  }
});

// --- parseUnifiedDiff ------------------------------------------------------

test('parseUnifiedDiff: splits added and removed content per file', () => {
  const d = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,3 @@
 keep
-old line
+new line
`;
  const [f] = parseUnifiedDiff(d);
  assert.equal(f.file, 'src/x.ts');
  assert.deepEqual(f.added, ['new line']);
  assert.deepEqual(f.removed, ['old line']);
});

test('parseUnifiedDiff: flags a deleted file via +++ /dev/null', () => {
  const d = `diff --git a/tests/gone.test.js b/tests/gone.test.js
--- a/tests/gone.test.js
+++ /dev/null
@@ -1,2 +0,0 @@
-test('x', () => {});
`;
  const [f] = parseUnifiedDiff(d);
  assert.equal(f.deletedFile, true);
});

// --- scanTestTamper --------------------------------------------------------

test('scanTestTamper: clean production change raises nothing', () => {
  const d = `diff --git a/src/parser.py b/src/parser.py
--- a/src/parser.py
+++ b/src/parser.py
@@ -1 +1 @@
-def parse(x): return x
+def parse(x): return x.strip()
`;
  assert.deepEqual(scanTestTamper(d), { ok: true, flags: [] });
});

test('scanTestTamper: deleting a test file is flagged', () => {
  const d = `diff --git a/tests/test_x.py b/tests/test_x.py
--- a/tests/test_x.py
+++ /dev/null
@@ -1,3 +0,0 @@
-def test_a(): assert True
`;
  const { ok, flags } = scanTestTamper(d);
  assert.equal(ok, false);
  assert.equal(flags[0].kind, 'test-file-deleted');
});

test('scanTestTamper: removing more test declarations than are added is flagged', () => {
  const d = `diff --git a/a.test.js b/a.test.js
--- a/a.test.js
+++ b/a.test.js
@@ -1,6 +1,2 @@
-test('one', () => { expect(f()).toBe(1); });
-test('two', () => { expect(f()).toBe(2); });
 test('three', () => { expect(f()).toBe(3); });
`;
  const { flags } = scanTestTamper(d);
  assert.ok(flags.some((f) => f.kind === 'tests-removed'));
});

test('scanTestTamper: adding .skip / .only is flagged', () => {
  const d = `diff --git a/a.spec.ts b/a.spec.ts
--- a/a.spec.ts
+++ b/a.spec.ts
@@ -1 +1 @@
-describe('suite', () => {
+describe.skip('suite', () => {
`;
  const { flags } = scanTestTamper(d);
  assert.ok(flags.some((f) => f.kind === 'skip-or-only-added'));
});

test('scanTestTamper: a net drop of assertions is flagged', () => {
  const d = `diff --git a/t/x_test.go b/t/x_test.go
--- a/t/x_test.go
+++ b/t/x_test.go
@@ -1,5 +1,2 @@
-	require.NoError(t, err)
-	require.Equal(t, 2, got)
-	require.True(t, ok)
 	_ = got
`;
  const { flags } = scanTestTamper(d);
  assert.ok(flags.some((f) => f.kind === 'assertions-reduced'));
});

test('scanTestTamper: identical edits to a NON-test file are ignored', () => {
  const d = `diff --git a/src/app.js b/src/app.js
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,1 @@
-test('inline sanity', () => {});
-expect(1).toBe(1);
 run();
`;
  assert.deepEqual(scanTestTamper(d), { ok: true, flags: [] });
});
