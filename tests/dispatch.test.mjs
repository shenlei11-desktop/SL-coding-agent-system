import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  loadRepoConfig, resolveOptions, mergeAnti, baseDir, isConcrete,
  scopesOverlap, globToRegExp, REPO_CONFIG_NAME,
} from '../bin/lib/dispatch.mjs';

// --- loadRepoConfig -------------------------------------------------------------

test('loadRepoConfig: absent file yields empty config, no error', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ds-'));
  try {
    const r = loadRepoConfig(dir);
    assert.equal(r.path, null);
    assert.deepEqual(r.config, {});
    assert.equal(r.error, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadRepoConfig: reads JSON and strips _comment', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ds-'));
  try {
    writeFileSync(path.join(dir, REPO_CONFIG_NAME),
      JSON.stringify({ _comment: ['docs'], tier: 3, model: 'glm-5.2' }));
    const r = loadRepoConfig(dir);
    assert.ok(r.path);
    assert.deepEqual(r.config, { tier: 3, model: 'glm-5.2' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadRepoConfig: unparseable file returns error and empty config, not a throw', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ds-'));
  try {
    writeFileSync(path.join(dir, REPO_CONFIG_NAME), '{ not json ');
    const r = loadRepoConfig(dir);
    assert.deepEqual(r.config, {});
    assert.ok(r.error);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- resolveOptions -----------------------------------------------------------

test('resolveOptions: CLI flag beats repo config beats undefined', () => {
  const out = resolveOptions({ tier: '3' }, { tier: 2, model: 'glm-5.2' });
  assert.equal(out.tier, '3');           // CLI wins
  assert.equal(out.model, 'glm-5.2');    // repo fills the gap
  assert.equal(out.template, undefined); // neither set
});

test('resolveOptions: maps includeUnverified/keepStrays to their flags', () => {
  assert.equal(resolveOptions({ 'keep-strays': true }, {}).keepStrays, true);
  assert.equal(resolveOptions({}, { keepStrays: true }).keepStrays, true);
  assert.equal(resolveOptions({}, {}).keepStrays, undefined);
});

test('resolveOptions: array scope/seed from config collapse to a comma string', () => {
  const out = resolveOptions({}, { scope: ['a.md', 'b/**.md'], seed: ['x.md'] });
  assert.equal(out.scope, 'a.md,b/**.md');
  assert.equal(out.seed, 'x.md');
});

// --- mergeAnti --------------------------------------------------------------

test('mergeAnti: repo baseline first, then CLI, deduped and trimmed', () => {
  const lines = mergeAnti('  do not touch auth  \nno new deps', ['never edit README.md', 'no new deps']);
  assert.deepEqual(lines, ['never edit README.md', 'no new deps', 'do not touch auth']);
});

test('mergeAnti: tolerates undefined / boolean-true / empty', () => {
  assert.deepEqual(mergeAnti(undefined, undefined), []);
  assert.deepEqual(mergeAnti(true, null), []);
  assert.deepEqual(mergeAnti('', ['x']), ['x']);
});

// --- baseDir / isConcrete ---------------------------------------------------

test('baseDir: fixed prefix up to the first wildcard segment', () => {
  assert.equal(baseDir('src/http/client.ts'), 'src/http/client.ts');
  assert.equal(baseDir('src/**/x.ts'), 'src');
  assert.equal(baseDir('docs/*.md'), 'docs');
  assert.equal(baseDir('**/*.md'), '');
});

test('isConcrete: true only with no glob metacharacters', () => {
  assert.equal(isConcrete('a/b.md'), true);
  assert.equal(isConcrete('a/*.md'), false);
  assert.equal(isConcrete('a/b?.md'), false);
});

// --- globToRegExp ---------------------------------------------------------

test('globToRegExp: ** spans directories, * stays within a segment', () => {
  assert.ok(globToRegExp('docs/**').test('docs/a/b.md'));
  assert.ok(globToRegExp('src/**/*.ts').test('src/a/b/c.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegExp('src/*.ts').test('src/a.ts'));
});

// --- scopesOverlap ------------------------------------------------------------

test('scopesOverlap: distinct concrete files in the same dir do NOT overlap', () => {
  assert.equal(
    scopesOverlap(['scratch/mapping-L1.md'], ['scratch/mapping-L6.md']),
    false,
  );
});

test('scopesOverlap: identical concrete file overlaps', () => {
  assert.equal(scopesOverlap(['a/x.md'], ['a/x.md']), true);
});

test('scopesOverlap: a glob that covers a concrete path on the other side overlaps', () => {
  assert.equal(scopesOverlap(['docs/**'], ['docs/api.md']), true);
  assert.equal(scopesOverlap(['docs/api.md'], ['docs/**']), true);
});

test('scopesOverlap: sibling wildcard dirs do not overlap; nested ones do', () => {
  assert.equal(scopesOverlap(['src/a/**'], ['src/b/**']), false);
  assert.equal(scopesOverlap(['src/**'], ['src/b/**']), true);
});

test('scopesOverlap: an empty scope on either side means no overlap (unscoped run)', () => {
  assert.equal(scopesOverlap([], ['a.md']), false);
  assert.equal(scopesOverlap(['a.md'], []), false);
});

test('scopesOverlap: repo-wide glob overlaps anything', () => {
  assert.equal(scopesOverlap(['**/*.md'], ['deeply/nested/file.md']), true);
});
