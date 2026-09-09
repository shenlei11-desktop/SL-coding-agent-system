import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPayload } from '../scripts/usage-serve.mjs';

// A small unified-row set spanning both sources, two repos, two days.
const ROWS = [
  { ts: '2026-08-20T09:00:00.000Z', source: 'opencode', device_id: 'a', repo: 'alpha', model: 'opencode-go/glm-5.2', cost_usd: 0.10, ok: true, tokens: { input: null, output: null, cache_write: null, cache_read: null }, ext: { touched: 3 } },
  { ts: '2026-08-20T10:00:00.000Z', source: 'opencode', device_id: 'a', repo: 'alpha', model: 'opencode-go/glm-5.2', cost_usd: 0.20, ok: true, tokens: { input: null, output: null, cache_write: null, cache_read: null }, ext: { touched: 0 } },
  { ts: '2026-08-20T11:00:00.000Z', source: 'claude', device_id: 'b', repo: 'alpha', model: 'claude-sonnet-5', cost_usd: 5.00, ok: null, tokens: { input: 100, output: 40, cache_write: 10, cache_read: 900 }, ext: { session_id: 's1' } },
  { ts: '2026-08-21T09:00:00.000Z', source: 'claude', device_id: 'b', repo: 'beta', model: 'claude-opus-5', cost_usd: 2.00, ok: null, tokens: { input: 50, output: 20, cache_write: 5, cache_read: 400 }, ext: { session_id: 's2' } },
];

test('buildPayload: summary totals match the rows', () => {
  const p = buildPayload(ROWS);
  assert.equal(p.summary.totalRows, 4);
  assert.equal(p.summary.deviceCount, 2);
  assert.equal(Number(p.summary.totalCost.toFixed(2)), 7.30);
  assert.equal(Number(p.summary.bySource.opencode.toFixed(2)), 0.30);
  assert.equal(Number(p.summary.bySource.claude.toFixed(2)), 7.00);
  assert.equal(p.summary.firstTs, '2026-08-20T09:00:00.000Z');
  assert.equal(p.summary.lastTs, '2026-08-21T09:00:00.000Z');
});

test('buildPayload: byRepo collapses source into one row per repo, sorted by total desc', () => {
  const p = buildPayload(ROWS);
  assert.deepEqual(p.byRepo.map((r) => r.name), ['alpha', 'beta']);
  const alpha = p.byRepo[0];
  assert.equal(Number(alpha.claude.toFixed(2)), 5.00);
  assert.equal(Number(alpha.opencode.toFixed(2)), 0.30);
  assert.equal(Number(alpha.total.toFixed(2)), 5.30);
  assert.equal(alpha.runs, 3);
  assert.equal(alpha.okRuns, 2); // both opencode rows are ok:true; claude rows carry ok:null
  assert.equal(alpha.cacheRead, 900);
});

test('buildPayload: byModel keeps the source-qualified model name and never merges across sources', () => {
  const p = buildPayload(ROWS);
  const names = p.byModel.map((r) => r.name).sort();
  assert.deepEqual(names, ['claude-opus-5', 'claude-sonnet-5', 'opencode-go/glm-5.2']);
  const glm = p.byModel.find((r) => r.name === 'opencode-go/glm-5.2');
  assert.equal(Number(glm.opencode.toFixed(2)), 0.30);
  assert.equal(glm.claude, 0);
});

test('buildPayload: byDay splits each calendar day into claude vs opencode, ascending', () => {
  const p = buildPayload(ROWS);
  assert.deepEqual(p.byDay.map((d) => d.day), ['2026-08-20', '2026-08-21']);
  assert.equal(Number(p.byDay[0].opencode.toFixed(2)), 0.30);
  assert.equal(Number(p.byDay[0].claude.toFixed(2)), 5.00);
  assert.equal(Number(p.byDay[1].total.toFixed(2)), 2.00);
});

test('buildPayload: bottlenecks are flagged findings only, each trimmed to metric/group/value/threshold/evidence', () => {
  const p = buildPayload(ROWS);
  assert.ok(Array.isArray(p.bottlenecks));
  for (const f of p.bottlenecks) {
    assert.deepEqual(Object.keys(f).sort(), ['evidence', 'group', 'metric', 'threshold', 'value']);
  }
  // The one opencode ok/0-touched run makes wasted_dispatch fire for glm-5.2.
  assert.ok(p.bottlenecks.some((f) => f.metric === 'wasted_dispatch'));
});

test('buildPayload: empty input produces a well-formed empty payload', () => {
  const p = buildPayload([]);
  assert.equal(p.summary.totalRows, 0);
  assert.deepEqual(p.byRepo, []);
  assert.deepEqual(p.byModel, []);
  assert.deepEqual(p.byDay, []);
  assert.deepEqual(p.bottlenecks, []);
});
