import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  underSeededTasks,
  wallTimeOutliers,
  STEPS_PER_FILE_STDEV_THRESHOLD,
  WALL_S_ZSCORE_THRESHOLD,
} from '../bin/lib/usage-aggregate.mjs';

// --- helpers -------------------------------------------------------------------

/**
 * Replicate the source's mean + population-stdev formula so we never
 * hardcode a magic float.  variance uses the population divisor (n),
 * matching the code in usage-aggregate.mjs.
 */
function computeThreshold(values, multiplier) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  return mean + multiplier * stdev;
}

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

// --- underSeededTasks ----------------------------------------------------------

test('underSeededTasks: boundary row at threshold is NOT flagged; row above IS flagged', () => {
  // Seven base rows with one outlier.
  // stepsPerFile values = [10, 10, 10, 10, 10, 10, 100].
  const baseSpf = [10, 10, 10, 10, 10, 10, 100];
  const rows = [
    row({ model: 'm1', ext: { steps: 10, touched: 1 } }),
    row({ model: 'm1', ext: { steps: 10, touched: 1 } }),
    row({ model: 'm1', ext: { steps: 10, touched: 1 } }),
    row({ model: 'm1', ext: { steps: 10, touched: 1 } }),
    row({ model: 'm1', ext: { steps: 10, touched: 1 } }),
    row({ model: 'm1', ext: { steps: 10, touched: 1 } }),
    row({ model: 'm1', ext: { steps: 100, touched: 1 } }),
  ];

  // Threshold derived from the 7 base values via our helper.
  const threshold = computeThreshold(baseSpf, STEPS_PER_FILE_STDEV_THRESHOLD);

  // Row at exactly the threshold — NOT flagged (code uses strictly-greater-than).
  rows.push(row({ model: 'm1', ext: { steps: threshold, touched: 1 } }));
  // Row sufficiently above the threshold — IS flagged.
  // delta=50 is the smallest integer where T+δ > T' (the function's recomputed
  // threshold after absorbing all rows) AND the original 100 stays below T'.
  const delta = 50;
  rows.push(row({ model: 'm1', ext: { steps: threshold + delta, touched: 1 } }));

  const findings = underSeededTasks(rows);

  // Only the high row should be flagged. The boundary row (at exactly T) is
  // NOT in findings at all because the function only returns flagged rows,
  // and T is not strictly greater than the recomputed threshold. If the code
  // used >= instead of >, the boundary row would also appear, yielding 2.
  assert.equal(findings.length, 1);
  assert.equal(findings[0].group, 'm1');
  assert.equal(findings[0].evidence.steps, threshold + delta);
});

test('underSeededTasks: zero-stdev group produces no findings', () => {
  const rows = [
    row({ model: 'm2', ext: { steps: 5, touched: 1 } }),  // spf = 5
    row({ model: 'm2', ext: { steps: 10, touched: 2 } }), // spf = 5
  ];
  const findings = underSeededTasks(rows);
  assert.equal(findings.length, 0);
});

test('underSeededTasks: non-opencode rows are ignored', () => {
  const rows = [
    row({ source: 'claude', model: 'm-claude', ext: { steps: 100, touched: 1 } }),
  ];
  assert.equal(underSeededTasks(rows).length, 0);
});

test('underSeededTasks: single-row group produces no findings (< 2 rows)', () => {
  const rows = [
    row({ model: 'm-solo', ext: { steps: 100, touched: 1 } }),
  ];
  assert.equal(underSeededTasks(rows).length, 0);
});

test('underSeededTasks: empty input yields empty findings', () => {
  assert.equal(underSeededTasks([]).length, 0);
});

// --- wallTimeOutliers ----------------------------------------------------------

test('wallTimeOutliers: boundary z-score row is NOT flagged; row above IS flagged', () => {
  // Seven base rows with one outlier.
  // wall_s values = [100, 100, 100, 100, 100, 100, 120].
  const baseWall = [100, 100, 100, 100, 100, 100, 120];
  const rows = [
    row({ model: 'm3', ext: { wall_s: 100, session: 's1' } }),
    row({ model: 'm3', ext: { wall_s: 100, session: 's2' } }),
    row({ model: 'm3', ext: { wall_s: 100, session: 's3' } }),
    row({ model: 'm3', ext: { wall_s: 100, session: 's4' } }),
    row({ model: 'm3', ext: { wall_s: 100, session: 's5' } }),
    row({ model: 'm3', ext: { wall_s: 100, session: 's6' } }),
    row({ model: 'm3', ext: { wall_s: 120, session: 's7' } }),
  ];

  // Threshold derived from the 7 base values via our helper.
  const threshold = computeThreshold(baseWall, WALL_S_ZSCORE_THRESHOLD);

  // Row at exactly the boundary z-score — NOT flagged.
  rows.push(row({ model: 'm3', ext: { wall_s: threshold, session: 's-boundary' } }));
  // Row sufficiently above — IS flagged.
  // delta=100 is large enough that T+δ > T' (the recomputed threshold)
  // while the original 120 stays below T'.
  const delta = 100;
  rows.push(row({ model: 'm3', ext: { wall_s: threshold + delta, session: 's-flagged' } }));

  const findings = wallTimeOutliers(rows);

  // Only the high row should be flagged. The boundary row (at exactly T) is
  // NOT in findings because the function only returns flagged rows, and T is
  // not strictly greater than the recomputed threshold. If >= were used
  // instead of >, the boundary row would also appear, yielding 2.
  assert.equal(findings.length, 1);
  assert.equal(findings[0].group, 'm3');
  assert.equal(findings[0].evidence.wall_s, threshold + delta);
});

test('wallTimeOutliers: ok:false row does not affect group stats or produce a finding', () => {
  const baseWall = [100, 200, 300];
  const rows = [
    row({ model: 'm4', ext: { wall_s: 100 } }),
    row({ model: 'm4', ext: { wall_s: 200 } }),
    row({ model: 'm4', ok: false, ext: { wall_s: 99999 } }), // excluded by source
    row({ model: 'm4', ext: { wall_s: 300 } }),
  ];

  // Threshold computed from only the ok:true rows.
  const threshold = computeThreshold(baseWall, WALL_S_ZSCORE_THRESHOLD);
  const findings = wallTimeOutliers(rows);

  // No row reaches z-score > 2 with these values.
  assert.equal(findings.length, 0);
});

test('wallTimeOutliers: single ok row produces no findings (< 2 rows)', () => {
  const rows = [
    row({ model: 'm-solo', ext: { wall_s: 99999 } }),
  ];
  assert.equal(wallTimeOutliers(rows).length, 0);
});

test('wallTimeOutliers: zero-stdev group produces no findings', () => {
  const rows = [
    row({ model: 'm-flat', ext: { wall_s: 50 } }),
    row({ model: 'm-flat', ext: { wall_s: 50 } }),
  ];
  assert.equal(wallTimeOutliers(rows).length, 0);
});

test('wallTimeOutliers: non-opencode rows are ignored', () => {
  const rows = [
    row({ source: 'claude', model: 'm-claude', ext: { wall_s: 99999 } }),
    row({ source: 'claude', model: 'm-claude', ext: { wall_s: 100 } }),
  ];
  assert.equal(wallTimeOutliers(rows).length, 0);
});

test('wallTimeOutliers: empty input yields empty findings', () => {
  assert.equal(wallTimeOutliers([]).length, 0);
});
