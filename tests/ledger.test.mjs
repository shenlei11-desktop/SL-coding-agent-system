import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseOpencodeLedger,
  aggregateByModel,
  aggregateByRepo,
  aggregateByBranch,
} from '../bin/lib/ledger.mjs';

// --- parseOpencodeLedger ------------------------------------------------------

test('parseOpencodeLedger: tolerates a row missing the optional "touched" field', () => {
  const fixture = JSON.stringify({
    ts: '2026-08-22T11:42:08.400Z',
    repo: 'SL-coding-agent-system',
    ok: false,
    agent: 't1-scribe',
    model: 'opencode-go/kimi-k2.6',
    branch: 'feat/agent-system',
    session: 'ses_fd6bb1599ffeFrrJLwhyq0yX0o',
    cost: 0.04605,
    steps: 6,
    wall_s: 151.9,
    attached: true,
    changed: ['EADME.md', '.agent/'],
    out_of_scope: ['EADME.md', '.agent/'],
    log: '.agent/logs/2026-08-22T11-39-36-518Z-tier1-kimi-k2.6.ndjson',
  });
  const rows = parseOpencodeLedger(fixture);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].repo, 'SL-coding-agent-system');
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].cost, 0.04605);
});

test('parseOpencodeLedger: drops an unparseable JSON line without throwing', () => {
  const text = '{"ok":true,"model":"x"}\n{ bad json \n{"ok":false,"model":"y"}\n';
  const rows = parseOpencodeLedger(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].model, 'x');
  assert.equal(rows[1].model, 'y');
});

test('parseOpencodeLedger: returns [] for empty input', () => {
  assert.deepEqual(parseOpencodeLedger(''), []);
  assert.deepEqual(parseOpencodeLedger(undefined), []);
});

// --- aggregateByRepo ----------------------------------------------------------

test('aggregateByRepo: groups correctly across multiple repos with correct sums', () => {
  const rows = [
    { repo: 'alpha', ok: true, cost: 0.1, wall_s: 10, out_of_scope: [] },
    { repo: 'alpha', ok: false, cost: 0.2, wall_s: 20, out_of_scope: ['x.md'] },
    { repo: 'beta', ok: true, cost: 0.05, wall_s: 5, out_of_scope: [] },
    { repo: 'beta', ok: true, cost: 0.15, wall_s: 15, out_of_scope: ['a.md', 'b.md'] },
  ];
  const by = aggregateByRepo(rows);
  assert.equal(by.size, 2);

  const a = by.get('alpha');
  assert.equal(a.runs, 2);
  assert.equal(a.ok, 1);
  assert.ok(Math.abs(a.cost - 0.3) < 1e-9);
  assert.equal(a.wall, 30);
  assert.equal(a.strays, 1);

  const b = by.get('beta');
  assert.equal(b.runs, 2);
  assert.equal(b.ok, 2);
  assert.equal(b.cost, 0.2);
  assert.equal(b.wall, 20);
  assert.equal(b.strays, 2);
});

test('aggregateByRepo: missing repo field maps to "unknown"', () => {
  const rows = [{ ok: true, cost: 1, wall_s: 2, out_of_scope: [] }];
  const by = aggregateByRepo(rows);
  assert.ok(by.has('unknown'));
  assert.equal(by.get('unknown').runs, 1);
});

// --- aggregateByBranch --------------------------------------------------------

test('aggregateByBranch: groups correctly across multiple branches with correct sums', () => {
  const rows = [
    { branch: 'main', ok: true, cost: 0.3, wall_s: 30, out_of_scope: [] },
    { branch: 'main', ok: true, cost: 0.1, wall_s: 10, out_of_scope: ['z.md'] },
    { branch: 'feat/x', ok: false, cost: 0.2, wall_s: 20, out_of_scope: [] },
  ];
  const by = aggregateByBranch(rows);
  assert.equal(by.size, 2);

  const m = by.get('main');
  assert.equal(m.runs, 2);
  assert.equal(m.ok, 2);
  assert.ok(Math.abs(m.cost - 0.4) < 1e-9);
  assert.equal(m.wall, 40);
  assert.equal(m.strays, 1);

  const f = by.get('feat/x');
  assert.equal(f.runs, 1);
  assert.equal(f.ok, 0);
  assert.equal(f.cost, 0.2);
  assert.equal(f.wall, 20);
  assert.equal(f.strays, 0);
});

test('aggregateByBranch: missing branch field maps to "unknown"', () => {
  const rows = [{ ok: false, cost: 0, wall_s: 0, out_of_scope: [] }];
  const by = aggregateByBranch(rows);
  assert.ok(by.has('unknown'));
  assert.equal(by.get('unknown').runs, 1);
});

// --- aggregateByModel (regression) --------------------------------------------

test('aggregateByModel: noWrite counts ok runs that touched nothing', () => {
  const rows = [
    { model: 'm1', ok: true, cost: 0.1, wall_s: 5, out_of_scope: [], changed: ['a.md'] },
    { model: 'm1', ok: true, cost: 0.2, wall_s: 10, out_of_scope: [] },
    { model: 'm1', ok: false, cost: 0.05, wall_s: 3, out_of_scope: [] },
  ];
  const by = aggregateByModel(rows);
  const m = by.get('m1');
  assert.equal(m.runs, 3);
  assert.equal(m.ok, 2);
  assert.equal(m.noWrite, 1);  // only the second ok run wrote nothing
});

test('aggregateByModel: missing model field maps to "unknown"', () => {
  const rows = [{ ok: true, cost: 1, wall_s: 2, out_of_scope: [], changed: [] }];
  const by = aggregateByModel(rows);
  assert.ok(by.has('unknown'));
  assert.equal(by.get('unknown').runs, 1);
  assert.equal(by.get('unknown').noWrite, 1);
});
