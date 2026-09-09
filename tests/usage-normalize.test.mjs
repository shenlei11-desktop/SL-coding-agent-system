import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeOpencodeRow, normalizeClaudeRow, mergeSources,
} from '../bin/lib/usage-normalize.mjs';

// --- normalizeOpencodeRow -----------------------------------------------------

test('normalizeOpencodeRow: all optional fields present maps every field', () => {
  const row = {
    ts: '2026-08-22T09:00:00.000Z',
    repo: 'my-repo',
    model: 'glm-5.2',
    agent: 'tier-3',
    steps: 12,
    wall_s: 45.3,
    attached: 3,
    touched: ['a.ts', 'b.ts'],
    changed: ['a.ts'],
    out_of_scope: ['vendor/lib.js'],
    session: 'sess-abc',
    branch: 'feature/x',
    cost: 0.042,
    ok: true,
  };
  const result = normalizeOpencodeRow(row, 'device-1');
  assert.deepEqual(result, {
    ts: '2026-08-22T09:00:00.000Z',
    source: 'opencode',
    device_id: 'device-1',
    repo: 'my-repo',
    branch: 'feature/x',
    model: 'glm-5.2',
    tokens: { input: null, output: null, cache_write: null, cache_read: null },
    cost_usd: 0.042,
    ok: true,
    ext: {
      agent: 'tier-3',
      steps: 12,
      wall_s: 45.3,
      attached: 3,
      touched: 2,
      out_of_scope: 1,
      session: 'sess-abc',
    },
  });
});

test('normalizeOpencodeRow: all optional fields absent applies documented defaults', () => {
  const row = {
    ts: '2026-08-22T09:00:00.000Z',
    repo: 'my-repo',
    model: 'glm-5.2',
    ok: true,
  };
  const result = normalizeOpencodeRow(row, 'device-2');
  assert.deepEqual(result, {
    ts: '2026-08-22T09:00:00.000Z',
    source: 'opencode',
    device_id: 'device-2',
    repo: 'my-repo',
    branch: null,
    model: 'glm-5.2',
    tokens: { input: null, output: null, cache_write: null, cache_read: null },
    cost_usd: 0,
    ok: true,
    ext: {
      agent: undefined,
      steps: 0,
      wall_s: 0,
      attached: null,
      touched: 0,
      out_of_scope: 0,
      session: null,
    },
  });
});

// --- normalizeClaudeRow -------------------------------------------------------

test('normalizeClaudeRow: real captured opus-5 usage costs exactly 0.13773575 and tokens pull through', () => {
  const row = {
    ts: '2026-08-22T10:31:16.272Z',
    session_id: 'abc123',
    model: 'claude-opus-5',
    repo: 'SL-coding-agent-system',
    branch: 'main',
    effort: 'high',
    usage: {
      input_tokens: 2,
      cache_creation_input_tokens: 14771,
      cache_read_input_tokens: 23714,
      output_tokens: 1342,
    },
  };
  const result = normalizeClaudeRow(row, 'device-1');
  assert.equal(result.cost_usd, 0.13773575);
  assert.deepEqual(result.tokens, {
    input: 2,
    output: 1342,
    cache_write: 14771,
    cache_read: 23714,
  });
  assert.equal(result.ts, '2026-08-22T10:31:16.272Z');
  assert.equal(result.source, 'claude');
  assert.equal(result.device_id, 'device-1');
  assert.equal(result.repo, 'SL-coding-agent-system');
  assert.equal(result.branch, 'main');
  assert.equal(result.model, 'claude-opus-5');
  assert.equal(result.ok, null);
  assert.deepEqual(result.ext, { session_id: 'abc123', effort: 'high' });
});

test('normalizeClaudeRow: model unknown to pricing table falls back cost_usd to 0, not null', () => {
  const row = {
    ts: '2026-08-22T11:00:00.000Z',
    session_id: 'xyz',
    model: 'claude-instant-1',
    repo: 'my-repo',
    branch: 'main',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
  const result = normalizeClaudeRow(row, 'device-3');
  assert.equal(result.cost_usd, 0);
  assert.equal(typeof result.cost_usd, 'number');
});

// --- mergeSources -------------------------------------------------------------

test('mergeSources: two out-of-order arrays merge into ascending ts order', () => {
  const opencodeRows = [
    { ts: '2026-08-22T10:00:00.000Z', source: 'opencode' },
    { ts: '2026-08-22T12:00:00.000Z', source: 'opencode' },
  ];
  const claudeRows = [
    { ts: '2026-08-22T09:00:00.000Z', source: 'claude' },
    { ts: '2026-08-22T11:00:00.000Z', source: 'claude' },
  ];
  // Inputs are NOT in chronological order: opencode starts at 10:00, claude has 09:00.
  const merged = mergeSources(opencodeRows, claudeRows);
  assert.equal(merged.length, 4);
  assert.deepEqual(merged.map((r) => r.ts), [
    '2026-08-22T09:00:00.000Z',
    '2026-08-22T10:00:00.000Z',
    '2026-08-22T11:00:00.000Z',
    '2026-08-22T12:00:00.000Z',
  ]);
});

test('mergeSources: claude-first input order still sorts ascending', () => {
  const opencodeRows = [
    { ts: '2026-08-22T11:00:00.000Z', source: 'opencode' },
  ];
  const claudeRows = [
    { ts: '2026-08-22T10:00:00.000Z', source: 'claude' },
  ];
  const merged = mergeSources(opencodeRows, claudeRows);
  assert.deepEqual(merged.map((r) => r.ts), [
    '2026-08-22T10:00:00.000Z',
    '2026-08-22T11:00:00.000Z',
  ]);
});
