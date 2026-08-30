import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  sanitizeDeviceId,
  resolveDeviceId,
  buildDeviceSnapshot,
  writeDeviceSnapshot,
  readAllDeviceSnapshots,
} from '../bin/lib/usage-device.mjs';

// --- sanitizeDeviceId ---------------------------------------------------------

test('sanitizeDeviceId: hostname with spaces, uppercase, punctuation produces lowercase-dashed id', () => {
  assert.equal(sanitizeDeviceId('My PC!'), 'my-pc');
});

test('sanitizeDeviceId: consecutive invalid characters collapse to a single dash', () => {
  assert.equal(sanitizeDeviceId('foo!!!bar'), 'foo-bar');
  assert.equal(sanitizeDeviceId('a   b'), 'a-b');
  assert.equal(sanitizeDeviceId('x@@@###$$$y'), 'x-y');
});

test('sanitizeDeviceId: leading and trailing dashes are stripped', () => {
  assert.equal(sanitizeDeviceId('-test-'), 'test');
  assert.equal(sanitizeDeviceId('---hello---'), 'hello');
  assert.equal(sanitizeDeviceId('-a-b-'), 'a-b');
});

test('sanitizeDeviceId: empty or whitespace-only input returns unknown-device', () => {
  assert.equal(sanitizeDeviceId(''), 'unknown-device');
  assert.equal(sanitizeDeviceId('   '), 'unknown-device');
  assert.equal(sanitizeDeviceId(undefined), 'unknown-device');
  assert.equal(sanitizeDeviceId(null), 'unknown-device');
});

// --- resolveDeviceId ----------------------------------------------------------

test('resolveDeviceId: AGENT_DEVICE_ID in env object is used and sanitized instead of calling hostnameFn', () => {
  const env = { AGENT_DEVICE_ID: 'My Laptop!' };
  let called = false;
  const hostnameFn = () => { called = true; return 'should-not-be-used'; };
  const result = resolveDeviceId(env, hostnameFn);
  assert.equal(result, 'my-laptop');
  assert.equal(called, false);
});

test('resolveDeviceId: empty-string AGENT_DEVICE_ID falls back to hostnameFn return value', () => {
  const env = { AGENT_DEVICE_ID: '' };
  const hostnameFn = () => 'clean-host';
  assert.equal(resolveDeviceId(env, hostnameFn), 'clean-host');
});

test('resolveDeviceId: whitespace-only AGENT_DEVICE_ID falls back to hostnameFn', () => {
  const env = { AGENT_DEVICE_ID: '   ' };
  const hostnameFn = () => 'fallback-host';
  assert.equal(resolveDeviceId(env, hostnameFn), 'fallback-host');
});

test('resolveDeviceId: hostnameFn return value is itself sanitized', () => {
  const env = {};
  const hostnameFn = () => 'My Desktop!!';
  assert.equal(resolveDeviceId(env, hostnameFn), 'my-desktop');
});

test('resolveDeviceId: missing AGENT_DEVICE_ID key falls back to hostnameFn', () => {
  const env = {};
  const hostnameFn = () => 'server-01';
  assert.equal(resolveDeviceId(env, hostnameFn), 'server-01');
});

// --- buildDeviceSnapshot ------------------------------------------------------

test('buildDeviceSnapshot: opencodeLedgerRows map one-to-one with no rollup', () => {
  const ledgerRows = [
    { ts: '2026-08-22T09:00:00.000Z', repo: 'repo-a', model: 'glm-5.2', agent: 'tier-2', cost: 0.01, ok: true },
    { ts: '2026-08-22T09:05:00.000Z', repo: 'repo-b', model: 'glm-5.2', agent: 'tier-3', steps: 5, cost: 0.02 },
    { ts: '2026-08-22T09:10:00.000Z', repo: 'repo-a', model: 'glm-4', cost: 0.03, ok: false },
  ];
  const result = buildDeviceSnapshot({ opencodeLedgerRows: ledgerRows, claudeTranscriptRows: [], deviceId: 'dev-1' });
  assert.equal(result.length, 3);
  assert.equal(result[0].source, 'opencode');
  assert.equal(result[0].device_id, 'dev-1');
  // Spot-check: cost pulls through correctly
  assert.equal(result[0].cost_usd, 0.01);
  assert.equal(result[1].cost_usd, 0.02);
  assert.equal(result[2].cost_usd, 0.03);
  // Spot-check: ok field maps correctly
  assert.equal(result[0].ok, true);
  assert.equal(result[2].ok, false);
  // All rows are opencode source
  assert.ok(result.every((r) => r.source === 'opencode'));
});

test('buildDeviceSnapshot: multiple claude rows with same session_id and model roll up into ONE row with summed tokens', () => {
  // Three turns with known usage; hand-summed totals below.
  const claudeRows = [
    {
      ts: '2026-08-22T10:00:00.000Z',
      session_id: 'sess-1',
      model: 'claude-opus-5',
      repo: 'my-repo',
      branch: 'main',
      effort: 'high',
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 },
    },
    {
      ts: '2026-08-22T10:05:00.000Z',
      session_id: 'sess-1',
      model: 'claude-opus-5',
      repo: 'my-repo',
      branch: 'main',
      effort: 'high',
      usage: { input_tokens: 150, output_tokens: 75, cache_creation_input_tokens: 100, cache_read_input_tokens: 50 },
    },
    {
      ts: '2026-08-22T10:10:00.000Z',
      session_id: 'sess-1',
      model: 'claude-opus-5',
      repo: 'my-repo',
      branch: 'main',
      effort: 'high',
      usage: { input_tokens: 50, output_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 100 },
    },
  ];
  // Hand-summed: input=300, output=150, cache_write=300, cache_read=450
  const result = buildDeviceSnapshot({ opencodeLedgerRows: [], claudeTranscriptRows: claudeRows, deviceId: 'dev-2' });
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'claude');
  assert.deepEqual(result[0].tokens, { input: 300, output: 150, cache_write: 300, cache_read: 450 });
});

test('buildDeviceSnapshot: rolled-up row ts equals the EARLIEST ts among the group, not the latest', () => {
  // Timestamps deliberately out of order: the earliest is the third entry.
  const claudeRows = [
    {
      ts: '2026-08-22T10:30:00.000Z',
      session_id: 'sess-x',
      model: 'claude-sonnet-4',
      repo: 'repo-c',
      branch: 'dev',
      effort: 'medium',
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    {
      ts: '2026-08-22T10:45:00.000Z',
      session_id: 'sess-x',
      model: 'claude-sonnet-4',
      repo: 'repo-c',
      branch: 'dev',
      effort: 'medium',
      usage: { input_tokens: 20, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    {
      ts: '2026-08-22T10:00:00.000Z',
      session_id: 'sess-x',
      model: 'claude-sonnet-4',
      repo: 'repo-c',
      branch: 'dev',
      effort: 'medium',
      usage: { input_tokens: 5, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  ];
  const result = buildDeviceSnapshot({ opencodeLedgerRows: [], claudeTranscriptRows: claudeRows, deviceId: 'dev-3' });
  assert.equal(result.length, 1);
  assert.equal(result[0].ts, '2026-08-22T10:00:00.000Z');
});

test('buildDeviceSnapshot: same session_id but DIFFERENT models produce two separate rows', () => {
  const claudeRows = [
    {
      ts: '2026-08-22T11:00:00.000Z',
      session_id: 'sess-y',
      model: 'claude-opus-5',
      repo: 'repo-d',
      branch: 'main',
      effort: 'high',
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 20 },
    },
    {
      ts: '2026-08-22T11:05:00.000Z',
      session_id: 'sess-y',
      model: 'claude-sonnet-4',
      repo: 'repo-d',
      branch: 'main',
      effort: 'high',
      usage: { input_tokens: 200, output_tokens: 80, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 },
    },
  ];
  const result = buildDeviceSnapshot({ opencodeLedgerRows: [], claudeTranscriptRows: claudeRows, deviceId: 'dev-4' });
  assert.equal(result.length, 2);
  const models = result.map((r) => r.model);
  assert.ok(models.includes('claude-opus-5'));
  assert.ok(models.includes('claude-sonnet-4'));
  // Each model gets its own token totals, not merged
  const opusRow = result.find((r) => r.model === 'claude-opus-5');
  const sonnetRow = result.find((r) => r.model === 'claude-sonnet-4');
  assert.deepEqual(opusRow.tokens, { input: 100, output: 50, cache_write: 10, cache_read: 20 });
  assert.deepEqual(sonnetRow.tokens, { input: 200, output: 80, cache_write: 30, cache_read: 40 });
});

test('buildDeviceSnapshot: opencode rows come first, then claude rows', () => {
  const ledgerRows = [
    { ts: '2026-08-22T09:00:00.000Z', repo: 'repo-a', model: 'glm-5.2' },
  ];
  const claudeRows = [
    {
      ts: '2026-08-22T08:00:00.000Z',
      session_id: 'sess-z',
      model: 'claude-opus-5',
      repo: 'repo-b',
      branch: 'main',
      effort: 'low',
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  ];
  const result = buildDeviceSnapshot({ opencodeLedgerRows: ledgerRows, claudeTranscriptRows: claudeRows, deviceId: 'dev-5' });
  assert.equal(result.length, 2);
  // Opencode first despite having a later timestamp
  assert.equal(result[0].source, 'opencode');
  assert.equal(result[1].source, 'claude');
});

test('buildDeviceSnapshot: empty opencodeLedgerRows and empty claudeTranscriptRows produce an empty array', () => {
  const result = buildDeviceSnapshot({ opencodeLedgerRows: [], claudeTranscriptRows: [], deviceId: 'dev-6' });
  assert.deepEqual(result, []);
});

test('buildDeviceSnapshot: null opencodeLedgerRows and null claudeTranscriptRows produce an empty array', () => {
  const result = buildDeviceSnapshot({ opencodeLedgerRows: null, claudeTranscriptRows: null, deviceId: 'dev-7' });
  assert.deepEqual(result, []);
});

test('buildDeviceSnapshot: empty opencode rows with claude rows returns only claude rows', () => {
  const claudeRows = [
    {
      ts: '2026-08-22T12:00:00.000Z',
      session_id: 'sess-only',
      model: 'claude-opus-5',
      repo: 'repo-e',
      branch: 'main',
      effort: 'medium',
      usage: { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 1, cache_read_input_tokens: 2 },
    },
  ];
  const result = buildDeviceSnapshot({ opencodeLedgerRows: [], claudeTranscriptRows: claudeRows, deviceId: 'dev-8' });
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'claude');
});

test('buildDeviceSnapshot: opencode rows with empty claude rows returns only opencode rows', () => {
  const ledgerRows = [
    { ts: '2026-08-22T09:00:00.000Z', repo: 'repo-f', model: 'glm-5.2', cost: 0.05 },
  ];
  const result = buildDeviceSnapshot({ opencodeLedgerRows: ledgerRows, claudeTranscriptRows: [], deviceId: 'dev-9' });
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'opencode');
  assert.equal(result[0].cost_usd, 0.05);
});

// --- writeDeviceSnapshot ------------------------------------------------------

test('writeDeviceSnapshot + readAllDeviceSnapshots: round-trip a small array of literal rows', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'usage-device-'));
  try {
    const rows = [
      { source: 'opencode', device_id: 'dev-rt', ts: '2026-08-22T09:00:00.000Z', repo: 'repo-a', model: 'glm-5.2', cost_usd: 0.01, ok: true },
      { source: 'claude', device_id: 'dev-rt', ts: '2026-08-22T10:00:00.000Z', session_id: 'sess-rt', model: 'claude-opus-5', tokens: { input: 300, output: 150, cache_write: 300, cache_read: 450 } },
    ];
    writeDeviceSnapshot(path.join(dir, 'dev-rt.jsonl'), rows);
    assert.deepEqual(readAllDeviceSnapshots(dir), rows);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('writeDeviceSnapshot: a second write to the same path fully overwrites, never appends', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'usage-device-'));
  try {
    const filePath = path.join(dir, 'dev-over.jsonl');
    const firstRows = [
      { source: 'opencode', device_id: 'dev-over', ts: '2026-08-22T09:00:00.000Z', marker: 'first-write' },
      { source: 'opencode', device_id: 'dev-over', ts: '2026-08-22T09:05:00.000Z', marker: 'first-write' },
    ];
    writeDeviceSnapshot(filePath, firstRows);

    const secondRows = [
      { source: 'claude', device_id: 'dev-over', ts: '2026-08-22T10:00:00.000Z', marker: 'second-write' },
    ];
    writeDeviceSnapshot(filePath, secondRows);

    // A leaked first-write row carries marker 'first-write' and pushes the
    // length past 1; both assertions hold only after a full overwrite.
    const readBack = readAllDeviceSnapshots(dir);
    assert.equal(readBack.length, 1);
    assert.deepEqual(readBack, secondRows);
    assert.ok(readBack.every((r) => r.marker !== 'first-write'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('writeDeviceSnapshot: creates the parent directory automatically when it does not already exist', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'usage-device-'));
  try {
    // Two levels of missing directories: only a recursive mkdir gets there.
    const nested = path.join(dir, 'usage', 'brand-new');
    const rows = [
      { source: 'opencode', device_id: 'dev-new', ts: '2026-08-22T09:00:00.000Z', repo: 'repo-a', model: 'glm-5.2', cost_usd: 0.01 },
    ];
    writeDeviceSnapshot(path.join(nested, 'dev-new.jsonl'), rows);
    assert.deepEqual(readAllDeviceSnapshots(nested), rows);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('writeDeviceSnapshot: empty rows array produces a file that reads back as an empty array, not an error', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'usage-device-'));
  try {
    const filePath = path.join(dir, 'dev-empty.jsonl');
    writeDeviceSnapshot(filePath, []);
    // The file is still produced (not skipped) and contains no rows.
    assert.ok(existsSync(filePath));
    assert.deepEqual(readAllDeviceSnapshots(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- readAllDeviceSnapshots ---------------------------------------------------

test('readAllDeviceSnapshots: directory that does not exist at all returns an empty array without throwing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'usage-device-'));
  try {
    const missing = path.join(dir, 'no-such-directory');
    assert.deepEqual(readAllDeviceSnapshots(missing), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readAllDeviceSnapshots: merges rows from two separate device files into one combined array', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'usage-device-'));
  try {
    const rowsA = [
      { source: 'opencode', device_id: 'dev-a', ts: '2026-08-22T09:00:00.000Z', repo: 'repo-a', model: 'glm-5.2', cost_usd: 0.01 },
    ];
    const rowsB = [
      { source: 'claude', device_id: 'dev-b', ts: '2026-08-22T10:00:00.000Z', model: 'claude-opus-5' },
      { source: 'claude', device_id: 'dev-b', ts: '2026-08-22T11:00:00.000Z', model: 'claude-sonnet-4' },
    ];
    writeDeviceSnapshot(path.join(dir, 'dev-a.jsonl'), rowsA);
    writeDeviceSnapshot(path.join(dir, 'dev-b.jsonl'), rowsB);

    const combined = readAllDeviceSnapshots(dir);
    assert.equal(combined.length, 3);
    // Order across files is not promised, so identify rows by device_id.
    assert.deepEqual(combined.map((r) => r.device_id).sort(), ['dev-a', 'dev-b', 'dev-b']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readAllDeviceSnapshots: skips a malformed line but keeps valid lines from that file and other files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'usage-device-'));
  try {
    writeDeviceSnapshot(path.join(dir, 'dev-good.jsonl'), [
      { source: 'opencode', device_id: 'dev-good', ts: '2026-08-22T09:00:00.000Z', repo: 'repo-a', cost_usd: 0.01 },
    ]);

    // One malformed line sandwiched between two valid lines: skipping just
    // that line keeps both neighbours and leaves the other file untouched.
    const validBefore = { source: 'claude', device_id: 'dev-broken', ts: '2026-08-22T10:00:00.000Z' };
    const validAfter = { source: 'claude', device_id: 'dev-broken', ts: '2026-08-22T10:05:00.000Z' };
    writeFileSync(path.join(dir, 'dev-broken.jsonl'),
      `${JSON.stringify(validBefore)}\n{ this line is not json\n${JSON.stringify(validAfter)}\n`);

    const rows = readAllDeviceSnapshots(dir);
    assert.equal(rows.length, 3);
    const broken = rows.filter((r) => r.device_id === 'dev-broken');
    assert.deepEqual(broken.map((r) => r.ts).sort(), ['2026-08-22T10:00:00.000Z', '2026-08-22T10:05:00.000Z']);
    assert.ok(rows.some((r) => r.device_id === 'dev-good'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
