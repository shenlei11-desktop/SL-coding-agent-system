#!/usr/bin/env node
/**
 * ledger.mjs — summarise past delegations.
 *
 * The dispatcher appends one line per run to ~/.agent-system/state/ledger.jsonl.
 * This reads it back so tier placement and model choice can be judged on this
 * machine's actual results rather than on model names — which is how the current
 * tier table was guessed in the first place.
 *
 *   node scripts/ledger.mjs [--last N] [--by-model] [--failures]
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const STATE_DIR = process.env.AGENT_STATE_DIR || path.join(homedir(), '.agent-system', 'state');
const LEDGER = path.join(STATE_DIR, 'ledger.jsonl');

if (!existsSync(LEDGER)) {
  console.log('no ledger yet — it is written on the first dispatch');
  process.exit(0);
}

const rows = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

if (args.includes('--failures')) {
  const bad = rows.filter((r) => !r.ok);
  console.log(`\n${bad.length} failed run(s) of ${rows.length}\n`);
  for (const r of bad.slice(-Number(argVal('--last', 20)))) {
    console.log(`  ${r.ts}  ${r.model}  ${r.repo}`);
    console.log(`     ${r.error || (r.out_of_scope?.length ? `out of scope: ${r.out_of_scope.join(', ')}` : 'unknown')}`);
  }
  console.log();
  process.exit(0);
}

if (args.includes('--by-model')) {
  const by = new Map();
  for (const r of rows) {
    const k = r.model || 'unknown';
    const e = by.get(k) || { runs: 0, ok: 0, cost: 0, wall: 0, strays: 0 };
    e.runs++; if (r.ok) e.ok++;
    e.cost += r.cost || 0; e.wall += r.wall_s || 0;
    e.strays += (r.out_of_scope || []).length;
    by.set(k, e);
  }
  console.log('\n  model                          runs   pass%   avg s   avg $     strays');
  console.log('  ' + '-'.repeat(72));
  const sorted = [...by.entries()].sort((a, b) => b[1].runs - a[1].runs);
  for (const [m, e] of sorted) {
    const pass = ((e.ok / e.runs) * 100).toFixed(0).padStart(4);
    const avgS = (e.wall / e.runs).toFixed(1).padStart(6);
    const avgC = (e.cost / e.runs).toFixed(4).padStart(7);
    console.log(`  ${m.padEnd(30)} ${String(e.runs).padStart(4)}   ${pass}%  ${avgS}  ${avgC}  ${String(e.strays).padStart(6)}`);
  }
  console.log('\n  Pass% counts scope violations and errors, not code correctness —');
  console.log('  a run can pass here and still be wrong. Judge tiers on both.\n');
  process.exit(0);
}

const n = Number(argVal('--last', 15));
const recent = rows.slice(-n);
const totalCost = rows.reduce((s, r) => s + (r.cost || 0), 0);

console.log(`\n  ${rows.length} run(s) recorded, ${totalCost.toFixed(4)} total delegate cost\n`);
console.log('  when                 ok   model                        s      $       files');
console.log('  ' + '-'.repeat(78));
for (const r of recent) {
  const when = (r.ts || '').slice(5, 16).replace('T', ' ');
  const flag = r.ok ? ' ok ' : 'FAIL';
  console.log(
    `  ${when.padEnd(20)} ${flag}  ${String(r.model || '').padEnd(28)} `
    + `${String(r.wall_s ?? '').padStart(5)}  ${(r.cost ?? 0).toFixed(4)}  ${(r.changed || []).length}`,
  );
}
console.log();
