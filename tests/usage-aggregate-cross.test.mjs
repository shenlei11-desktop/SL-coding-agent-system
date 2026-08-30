import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  poorCacheReuse,
  underDelegation,
  CACHE_REUSE_THRESHOLD,
  UNDER_DELEGATION_THRESHOLD,
  UNDER_DELEGATION_FLOOR_USD,
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

// --- poorCacheReuse -------------------------------------------------------------

test('poorCacheReuse: sums tokens across rows of one session and flags a ratio below the threshold', () => {
  const rows = [
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's-poor' },
      tokens: { input: 100, output: 5, cache_write: 50, cache_read: 10 },
    }),
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's-poor' },
      tokens: { input: 50, output: 5, cache_write: 50, cache_read: 20 },
    }),
  ];
  const findings = poorCacheReuse(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].metric, 'poor_cache_reuse');
  assert.equal(findings[0].group, 's-poor');
  assert.equal(findings[0].threshold, CACHE_REUSE_THRESHOLD);
  assert.ok(30 / 280 < CACHE_REUSE_THRESHOLD); // hand-computed ratio is clearly below
  // hand-computed: summed cache_read 30 / (summed input 150 + cache_write 100 + cache_read 30)
  assert.equal(findings[0].value, 30 / 280);
  assert.equal(findings[0].flagged, true);
  assert.deepEqual(findings[0].evidence, {
    summedInput: 150,
    summedCacheWrite: 100,
    summedCacheRead: 30,
    rowCount: 2,
  });
});

test('poorCacheReuse: a session whose summed ratio is above the threshold is not flagged', () => {
  const rows = [
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's-healthy' },
      tokens: { input: 10, output: 5, cache_write: 10, cache_read: 40 },
    }),
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's-healthy' },
      tokens: { input: 0, output: 5, cache_write: 10, cache_read: 50 },
    }),
  ];
  const findings = poorCacheReuse(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].group, 's-healthy');
  // hand-computed: summed cache_read 90 / (summed input 10 + cache_write 20 + cache_read 90)
  assert.equal(findings[0].value, 90 / 120);
  assert.equal(findings[0].flagged, false);
});

test('poorCacheReuse: a ratio exactly at the threshold is not flagged', () => {
  const rows = [
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's-edge' },
      tokens: { input: 70, output: 5, cache_write: 0, cache_read: 30 },
    }),
  ];
  const findings = poorCacheReuse(rows);
  assert.equal(findings.length, 1);
  // hand-computed: cache_read 30 / (input 70 + cache_write 0 + cache_read 30) = 30/100
  assert.equal(findings[0].value, CACHE_REUSE_THRESHOLD);
  assert.equal(findings[0].flagged, false);
});

test('poorCacheReuse: rows with different session_id values produce separate findings', () => {
  const rows = [
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's-a' },
      tokens: { input: 100, output: 5, cache_write: 0, cache_read: 0 },
    }),
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's-b' },
      tokens: { input: 0, output: 5, cache_write: 10, cache_read: 90 },
    }),
  ];
  const findings = poorCacheReuse(rows);
  assert.equal(findings.length, 2);
  const a = findings.find((f) => f.group === 's-a');
  const b = findings.find((f) => f.group === 's-b');
  assert.ok(a);
  assert.ok(b);
  // each finding uses only its own session's summed tokens, never a merged total
  assert.equal(a.value, 0 / 100);
  assert.equal(b.value, 90 / 100);
});

test('poorCacheReuse: non-claude rows are ignored entirely', () => {
  const rows = [
    row({
      source: 'opencode',
      tokens: { input: 100, output: 5, cache_write: 100, cache_read: 0 },
    }),
  ];
  assert.equal(poorCacheReuse(rows).length, 0);
});

test('poorCacheReuse: opencode rows never contribute to claude session sums', () => {
  const rows = [
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's-mix' },
      tokens: { input: 0, output: 5, cache_write: 10, cache_read: 90 },
    }),
    row({
      source: 'opencode',
      tokens: { input: 1000, output: 0, cache_write: 1000, cache_read: 0 },
    }),
  ];
  const findings = poorCacheReuse(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].group, 's-mix');
  assert.equal(findings[0].value, 90 / 100);
  assert.deepEqual(findings[0].evidence, {
    summedInput: 0,
    summedCacheWrite: 10,
    summedCacheRead: 90,
    rowCount: 1,
  });
});

test('poorCacheReuse: null and undefined token fields are treated as 0 in the sums', () => {
  const rows = [
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's-nulls' },
      tokens: { input: null, output: null, cache_write: 100, cache_read: null },
    }),
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's-nulls' },
      tokens: { input: undefined, output: 5, cache_write: 50, cache_read: 25 },
    }),
  ];
  const findings = poorCacheReuse(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].group, 's-nulls');
  // hand-computed: summed cache_read 25 / (summed input 0 + cache_write 150 + cache_read 25)
  assert.equal(findings[0].value, 25 / 175);
  assert.equal(findings[0].flagged, true);
  assert.deepEqual(findings[0].evidence, {
    summedInput: 0,
    summedCacheWrite: 150,
    summedCacheRead: 25,
    rowCount: 2,
  });
});

test('poorCacheReuse: a session whose token sums are all zero yields ratio 0 via the max(1, ...) guard', () => {
  const rows = [
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's-zero' },
      tokens: { input: 0, output: 0, cache_write: 0, cache_read: 0 },
    }),
  ];
  const findings = poorCacheReuse(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].value, 0);
  assert.equal(findings[0].flagged, true);
});

test('poorCacheReuse: empty input yields empty findings', () => {
  assert.equal(poorCacheReuse([]).length, 0);
});

// --- underDelegation -------------------------------------------------------------

test('underDelegation: flags a repo/day where claude spend dominates and matches the hand-computed gap', () => {
  const rows = [
    row({ source: 'claude', ok: null, ext: { session_id: 's1' }, cost_usd: 2 }),
    row({ source: 'claude', ok: null, ext: { session_id: 's1' }, cost_usd: 1 }),
    row({ source: 'opencode', cost_usd: 0.5 }),
  ];
  const findings = underDelegation(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].metric, 'under_delegation');
  assert.equal(findings[0].group, 'repo-a/2026-08-30');
  assert.equal(findings[0].threshold, UNDER_DELEGATION_THRESHOLD);
  assert.ok(3 > UNDER_DELEGATION_FLOOR_USD);       // claude spend clearly exceeds the floor
  assert.ok(3 / 3.5 > UNDER_DELEGATION_THRESHOLD); // hand-computed gap is clearly above
  // hand-computed: claude 3 / (claude 3 + opencode 0.5)
  assert.equal(findings[0].value, 3 / 3.5);
  assert.equal(findings[0].flagged, true);
  assert.deepEqual(findings[0].evidence, { claudeSpend: 3, opencodeSpend: 0.5 });
});

test('underDelegation: claude spend above the floor but outweighed by opencode spend is not flagged', () => {
  const rows = [
    row({ source: 'claude', ok: null, ext: { session_id: 's1' }, cost_usd: 1 }),
    row({ source: 'opencode', cost_usd: 3 }),
  ];
  const findings = underDelegation(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].group, 'repo-a/2026-08-30');
  // hand-computed: claude 1 / (claude 1 + opencode 3)
  assert.equal(findings[0].value, 1 / 4);
  assert.equal(findings[0].flagged, false);
});

test('underDelegation: a gap exactly at the threshold is not flagged', () => {
  const rows = [
    row({ source: 'claude', ok: null, ext: { session_id: 's1' }, cost_usd: 0.7 }),
    row({ source: 'opencode', cost_usd: 0.3 }),
  ];
  const findings = underDelegation(rows);
  assert.equal(findings.length, 1);
  // hand-computed: claude 0.7 / (claude 0.7 + opencode 0.3) = 0.7/1
  assert.equal(findings[0].value, UNDER_DELEGATION_THRESHOLD);
  assert.equal(findings[0].flagged, false);
});

test('underDelegation: claude spend not exceeding the floor produces no finding at all', () => {
  const rows = [
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's1' },
      cost_usd: UNDER_DELEGATION_FLOOR_USD,
    }),
    row({ source: 'opencode', cost_usd: 2 }),
  ];
  const findings = underDelegation(rows);
  // the group exists (the opencode row lands in it) but is skipped, not flagged:false
  assert.equal(
    findings.find((f) => f.group === 'repo-a/2026-08-30'),
    undefined
  );
});

test('underDelegation: a day with only opencode spend produces no finding', () => {
  const rows = [
    row({ source: 'opencode', cost_usd: 5 }),
    row({ source: 'opencode', cost_usd: 5 }),
  ];
  assert.equal(underDelegation(rows).length, 0);
});

test('underDelegation: two different days for the same repo are separate groups', () => {
  const rows = [
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's1' },
      ts: '2026-08-30T23:30:00Z',
      cost_usd: 2,
    }),
    row({
      source: 'claude',
      ok: null,
      ext: { session_id: 's1' },
      ts: '2026-08-31T00:30:00Z',
      cost_usd: 1.5,
    }),
    row({ source: 'opencode', ts: '2026-08-31T00:30:00Z', cost_usd: 0.5 }),
  ];
  const findings = underDelegation(rows);
  assert.equal(findings.length, 2);
  // days come from string-slicing ts, so 23:30Z and 00:30Z stay on their own UTC dates
  const d30 = findings.find((f) => f.group === 'repo-a/2026-08-30');
  const d31 = findings.find((f) => f.group === 'repo-a/2026-08-31');
  assert.ok(d30);
  assert.ok(d31);
  // each day's gap is computed from that day's spend only
  assert.equal(d30.value, 2 / 2); // claude 2 / (claude 2 + opencode 0)
  assert.equal(d31.value, 1.5 / 2); // claude 1.5 / (claude 1.5 + opencode 0.5)
});

test('underDelegation: two different repos on the same day are separate groups', () => {
  const rows = [
    row({ source: 'claude', ok: null, ext: { session_id: 's1' }, repo: 'repo-a', cost_usd: 2 }),
    row({ source: 'claude', ok: null, ext: { session_id: 's2' }, repo: 'repo-b', cost_usd: 1 }),
    row({ source: 'opencode', repo: 'repo-b', cost_usd: 0.5 }),
  ];
  const findings = underDelegation(rows);
  assert.equal(findings.length, 2);
  const a = findings.find((f) => f.group === 'repo-a/2026-08-30');
  const b = findings.find((f) => f.group === 'repo-b/2026-08-30');
  assert.ok(a);
  assert.ok(b);
  // each repo's gap is computed from that repo's spend only
  assert.equal(a.value, 2 / 2); // repo-a: claude 2 / (claude 2 + opencode 0)
  assert.equal(b.value, 1 / 1.5); // repo-b: claude 1 / (claude 1 + opencode 0.5)
  assert.equal(a.flagged, true);
  assert.equal(b.flagged, false); // 1/1.5 falls below the threshold
});

test('underDelegation: empty input yields empty findings', () => {
  assert.equal(underDelegation([]).length, 0);
});
