import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  byModel,
  byRepo,
  byDay,
  wastedDispatches,
  missingWarmServer,
} from '../bin/lib/usage-aggregate.mjs';

function row(overrides = {}) {
  return {
    ts: '2026-08-30T12:00:00Z',
    source: 'opencode',
    device_id: 'd1',
    repo: 'repo-a',
    branch: 'main',
    model: 'model-x',
    tokens: { input: null, output: null, cache_write: null, cache_read: null },
    cost_usd: 0,
    ok: true,
    ext: { steps: 0, wall_s: 0, attached: null, touched: 0, session: null },
    ...overrides,
  };
}

// --- byModel --------------------------------------------------------------------

test('byModel: keeps same model name from different sources in separate buckets', () => {
  const op = row({ source: 'opencode', model: 'shared-name' });
  const cl = row({ source: 'claude', model: 'shared-name', ok: null, ext: { session_id: 's1' } });
  const got = byModel([op, cl]);
  assert.equal(got.size, 2);
  assert.ok(got.has('opencode/shared-name'));
  assert.ok(got.has('claude/shared-name'));
});

test('byModel: accumulates counts, ok, cost, and treats null tokens as 0', () => {
  const r1 = row({
    source: 'opencode',
    model: 'm1',
    ok: true,
    cost_usd: 1.5,
    tokens: { input: 10, output: 5, cache_write: 1, cache_read: 2 },
  });
  const r2 = row({
    source: 'opencode',
    model: 'm1',
    ok: false,
    cost_usd: 0.5,
    tokens: { input: null, output: 7, cache_write: null, cache_read: 3 },
  });
  const got = byModel([r1, r2]).get('opencode/m1');
  assert.equal(got.count, 2);
  assert.equal(got.okCount, 1);
  assert.equal(got.totalCost, 2);
  assert.deepEqual(got.tokens, { input: 10, output: 12, cache_write: 1, cache_read: 5 });
});

test('byModel: empty input yields empty map', () => {
  assert.equal(byModel([]).size, 0);
});

// --- byRepo ---------------------------------------------------------------------

test('byRepo: keeps same repo name from different sources in separate buckets', () => {
  const op = row({ source: 'opencode', repo: 'shared-repo' });
  const cl = row({ source: 'claude', repo: 'shared-repo', ok: null, ext: { session_id: 's1' } });
  const got = byRepo([op, cl]);
  assert.equal(got.size, 2);
  assert.ok(got.has('opencode/shared-repo'));
  assert.ok(got.has('claude/shared-repo'));
});

test('byRepo: accumulates counts, ok, cost, and treats null tokens as 0', () => {
  const r1 = row({
    source: 'claude',
    repo: 'r1',
    ok: null,
    cost_usd: 2,
    tokens: { input: 20, output: 10, cache_write: 4, cache_read: 1 },
  });
  const r2 = row({
    source: 'claude',
    repo: 'r1',
    ok: null,
    cost_usd: 1,
    tokens: { input: 5, output: null, cache_write: 1, cache_read: null },
  });
  const got = byRepo([r1, r2]).get('claude/r1');
  assert.equal(got.count, 2);
  assert.equal(got.okCount, 0);
  assert.equal(got.totalCost, 3);
  assert.deepEqual(got.tokens, { input: 25, output: 10, cache_write: 5, cache_read: 1 });
});

test('byRepo: empty input yields empty map', () => {
  assert.equal(byRepo([]).size, 0);
});

// --- byDay ----------------------------------------------------------------------

test('byDay: keeps same calendar date from different sources in separate buckets', () => {
  const op = row({ source: 'opencode', ts: '2026-08-30T10:00:00Z' });
  const cl = row({ source: 'claude', ts: '2026-08-30T23:59:59Z', ok: null, ext: { session_id: 's1' } });
  const got = byDay([op, cl]);
  assert.equal(got.size, 2);
  assert.ok(got.has('opencode/2026-08-30'));
  assert.ok(got.has('claude/2026-08-30'));
});

test('byDay: extracts date by slicing ISO timestamp and accumulates correctly', () => {
  const r1 = row({
    source: 'opencode',
    ts: '2026-08-30T08:00:00Z',
    ok: true,
    cost_usd: 0.1,
    tokens: { input: 1, output: 2, cache_write: 0, cache_read: 0 },
  });
  const r2 = row({
    source: 'opencode',
    ts: '2026-08-31T08:00:00Z',
    ok: true,
    cost_usd: 0.2,
    tokens: { input: 3, output: 4, cache_write: 0, cache_read: 0 },
  });
  const got = byDay([r1, r2]);
  assert.equal(got.size, 2);
  const d30 = got.get('opencode/2026-08-30');
  const d31 = got.get('opencode/2026-08-31');
  assert.equal(d30.count, 1);
  assert.equal(d30.totalCost, 0.1);
  assert.equal(d31.count, 1);
  assert.equal(d31.totalCost, 0.2);
});

test('byDay: empty or missing timestamp falls back to unknown', () => {
  const r1 = row({ ts: '' });
  const r2 = row({ ts: undefined });
  const got = byDay([r1, r2]);
  assert.ok(got.has('opencode/unknown'));
  assert.equal(got.get('opencode/unknown').count, 2);
});

test('byDay: empty input yields empty map', () => {
  assert.equal(byDay([]).size, 0);
});

// --- wastedDispatches -----------------------------------------------------------

test('wastedDispatches: computes rate = touched-zero ok rows / all ok rows and flags when > 0', () => {
  const rows = [
    row({ source: 'opencode', model: 'm-waste', ok: true, ext: { touched: 0 } }),
    row({ source: 'opencode', model: 'm-waste', ok: true, ext: { touched: 1 } }),
    row({ source: 'opencode', model: 'm-waste', ok: true, ext: { touched: 0 } }),
  ];
  const findings = wastedDispatches(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].metric, 'wasted_dispatch');
  assert.equal(findings[0].group, 'm-waste');
  assert.equal(findings[0].value, 2 / 3);
  assert.equal(findings[0].flagged, true);
  assert.deepEqual(findings[0].evidence, { wastedCount: 2, okCount: 3 });
});

test('wastedDispatches: rate exactly 0 produces an unflagged finding', () => {
  const rows = [
    row({ source: 'opencode', model: 'm-clean', ok: true, ext: { touched: 2 } }),
    row({ source: 'opencode', model: 'm-clean', ok: true, ext: { touched: 1 } }),
  ];
  const findings = wastedDispatches(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].value, 0);
  assert.equal(findings[0].flagged, false);
});

test('wastedDispatches: model with zero ok:true rows produces no finding', () => {
  const rows = [
    row({ source: 'opencode', model: 'm-no-ok', ok: false, ext: { touched: 0 } }),
    row({ source: 'opencode', model: 'm-no-ok', ok: false, ext: { touched: 0 } }),
  ];
  const findings = wastedDispatches(rows);
  assert.equal(findings.find((f) => f.group === 'm-no-ok'), undefined);
});

test('wastedDispatches: non-opencode rows are ignored', () => {
  const rows = [
    row({ source: 'claude', model: 'm-claude', ok: true, ext: { touched: 0 } }),
  ];
  assert.equal(wastedDispatches(rows).length, 0);
});

test('wastedDispatches: empty input yields empty findings', () => {
  assert.equal(wastedDispatches([]).length, 0);
});

// --- missingWarmServer ----------------------------------------------------------

test('missingWarmServer: exactly threshold rate (0.8) is not flagged', () => {
  const rows = [
    row({ source: 'opencode', model: 'm-edge', ext: { attached: true } }),
    row({ source: 'opencode', model: 'm-edge', ext: { attached: true } }),
    row({ source: 'opencode', model: 'm-edge', ext: { attached: true } }),
    row({ source: 'opencode', model: 'm-edge', ext: { attached: true } }),
    row({ source: 'opencode', model: 'm-edge', ext: { attached: false } }),
  ];
  const got = missingWarmServer(rows).find((f) => f.group === 'm-edge');
  assert.ok(got);
  assert.equal(got.value, 0.8);
  assert.equal(got.flagged, false);
});

test('missingWarmServer: rate below threshold is flagged', () => {
  const rows = [
    row({ source: 'opencode', model: 'm-bad', ext: { attached: true } }),
    row({ source: 'opencode', model: 'm-bad', ext: { attached: true } }),
    row({ source: 'opencode', model: 'm-bad', ext: { attached: false } }),
    row({ source: 'opencode', model: 'm-bad', ext: { attached: false } }),
    row({ source: 'opencode', model: 'm-bad', ext: { attached: false } }),
  ];
  const got = missingWarmServer(rows).find((f) => f.group === 'm-bad');
  assert.ok(got);
  assert.equal(got.value, 0.4);
  assert.equal(got.flagged, true);
});

test('missingWarmServer: rows with non-boolean attached are excluded entirely', () => {
  const rows = [
    row({ source: 'opencode', model: 'm-skip', ext: { attached: true } }),
    row({ source: 'opencode', model: 'm-skip', ext: { attached: false } }),
    row({ source: 'opencode', model: 'm-skip', ext: { attached: null } }),
    row({ source: 'opencode', model: 'm-skip', ext: { attached: undefined } }),
  ];
  const got = missingWarmServer(rows).find((f) => f.group === 'm-skip');
  assert.ok(got);
  assert.equal(got.value, 0.5);
  assert.deepEqual(got.evidence, { attachedCount: 1, totalCount: 2 });
});

test('missingWarmServer: produces per-model findings plus one (all models) finding', () => {
  const rows = [
    row({ source: 'opencode', model: 'm-a', ext: { attached: true } }),
    row({ source: 'opencode', model: 'm-b', ext: { attached: false } }),
  ];
  const findings = missingWarmServer(rows);
  assert.equal(findings.length, 3);
  assert.ok(findings.some((f) => f.group === 'm-a'));
  assert.ok(findings.some((f) => f.group === 'm-b'));
  assert.ok(findings.some((f) => f.group === '(all models)'));
});

test('missingWarmServer: (all models) aggregate uses only boolean-attached rows', () => {
  const rows = [
    row({ source: 'opencode', model: 'm-x', ext: { attached: true } }),
    row({ source: 'opencode', model: 'm-y', ext: { attached: true } }),
    row({ source: 'opencode', model: 'm-z', ext: { attached: false } }),
    row({ source: 'opencode', model: 'm-z', ext: { attached: null } }),
  ];
  const got = missingWarmServer(rows).find((f) => f.group === '(all models)');
  assert.ok(got);
  assert.equal(got.value, 2 / 3);
  assert.deepEqual(got.evidence, { attachedCount: 2, totalCount: 3 });
});

test('missingWarmServer: non-opencode rows are ignored', () => {
  const rows = [
    row({ source: 'claude', model: 'm-claude', ext: { attached: false } }),
  ];
  assert.equal(missingWarmServer(rows).length, 0);
});

test('missingWarmServer: empty input yields empty findings', () => {
  assert.equal(missingWarmServer([]).length, 0);
});
