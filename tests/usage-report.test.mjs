import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, summarize, flaggedFindings } from '../scripts/usage.mjs';

// --- parseArgs -------------------------------------------------------------

test('parseArgs: no flags gives the recent view, refresh on, default last', () => {
  assert.deepEqual(parseArgs([]), {
    refresh: true, view: 'recent', device: null, last: 15,
  });
});

test('parseArgs: --no-refresh turns the pre-read snapshot rebuild off', () => {
  assert.equal(parseArgs(['--no-refresh']).refresh, false);
});

test('parseArgs: each view flag selects its view', () => {
  assert.equal(parseArgs(['--by-model']).view, 'by-model');
  assert.equal(parseArgs(['--by-repo']).view, 'by-repo');
  assert.equal(parseArgs(['--by-day']).view, 'by-day');
  assert.equal(parseArgs(['--bottlenecks']).view, 'bottlenecks');
});

test('parseArgs: --device and --last read their following value', () => {
  const o = parseArgs(['--device', 'box-2', '--last', '40']);
  assert.equal(o.device, 'box-2');
  assert.equal(o.last, 40);
});

// --- summarize -----------------------------------------------------------

test('summarize: empty rows produce all-zero headline numbers', () => {
  assert.deepEqual(summarize([]), {
    totalRows: 0, deviceCount: 0, totalCost: 0, bySource: {}, firstTs: null, lastTs: null,
  });
});

test('summarize: cost splits per source, devices are counted distinctly, ts span is min/max', () => {
  const rows = [
    { source: 'claude', device_id: 'a', ts: '2026-08-20T00:00:00.000Z', cost_usd: 1 },
    { source: 'claude', device_id: 'a', ts: '2026-08-25T00:00:00.000Z', cost_usd: 2 },
    { source: 'opencode', device_id: 'b', ts: '2026-08-10T00:00:00.000Z', cost_usd: 0.5 },
  ];
  const s = summarize(rows);
  assert.equal(s.totalRows, 3);
  assert.equal(s.deviceCount, 2);
  assert.equal(s.totalCost, 3.5);
  assert.deepEqual(s.bySource, { claude: 3, opencode: 0.5 });
  assert.equal(s.firstTs, '2026-08-10T00:00:00.000Z');
  assert.equal(s.lastTs, '2026-08-25T00:00:00.000Z');
});

// --- flaggedFindings ---------------------------------------------------

test('flaggedFindings: returns only flagged findings, drawn from more than one detector', () => {
  // wastedDispatches flags a model whose no-op rate clears the threshold
  // (here 1 of 2 = 0.5). missingWarmServer flags a model whose attach rate is
  // below 0.8 (here 0).
  const rows = [
    { source: 'opencode', model: 'm1', ok: true, ext: { touched: 0, attached: false } },
    { source: 'opencode', model: 'm1', ok: true, ext: { touched: 3, attached: false } },
  ];
  const found = flaggedFindings(rows);
  assert.ok(found.length >= 2);
  assert.ok(found.every((f) => f.flagged === true));
  const metrics = new Set(found.map((f) => f.metric));
  assert.ok(metrics.has('wasted_dispatch'));
  assert.ok(metrics.has('missing_warm_server'));
});

test('flaggedFindings: clean rows produce no findings', () => {
  const rows = [
    { source: 'opencode', model: 'm1', ok: true, ext: { touched: 5, attached: true } },
    { source: 'opencode', model: 'm1', ok: true, ext: { touched: 4, attached: true } },
  ];
  assert.deepEqual(flaggedFindings(rows), []);
});
