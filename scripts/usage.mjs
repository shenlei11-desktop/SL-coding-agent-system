#!/usr/bin/env node
/**
 * usage.mjs — the usage dashboard.
 *
 * Reads every device's committed snapshot (usage/<device-id>.jsonl, written by
 * scripts/usage-snapshot.mjs) and prints a cross-source, cross-device view of
 * where the spend and the time go. Claude Code and opencode are kept in
 * separate buckets throughout — the same model name from each never merges.
 *
 *   node scripts/usage.mjs [options]
 *
 *     --by-model      spend and tokens grouped by source/model
 *     --by-repo       ... by source/repo
 *     --by-day        ... by source/calendar day
 *     --bottlenecks   only the flagged findings from the six detectors
 *     --device ID     restrict to one device id
 *     --last N        rows to show in the default recent view (default 15)
 *     --no-refresh    skip rewriting THIS device's snapshot before reading
 *
 * By default this device's snapshot is rebuilt first (a cheap local rescan) so
 * the view is current; --no-refresh reads what is already on disk.
 */

import { pathToFileURL } from 'node:url';

import { readAllDeviceSnapshots } from '../bin/lib/usage-device.mjs';
import {
  byModel, byRepo, byDay,
  underSeededTasks, wastedDispatches, missingWarmServer,
  wallTimeOutliers, poorCacheReuse, underDelegation,
} from '../bin/lib/usage-aggregate.mjs';
import { resolvePaths, writeLocalSnapshot } from './usage-snapshot.mjs';

/**
 * Parse argv into the options the CLI acts on. Exported so the routing can be
 * tested without spawning the script.
 */
export function parseArgs(argv) {
  const has = (f) => argv.includes(f);
  const val = (f, d) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  let view = 'recent';
  if (has('--by-model')) view = 'by-model';
  else if (has('--by-repo')) view = 'by-repo';
  else if (has('--by-day')) view = 'by-day';
  else if (has('--bottlenecks')) view = 'bottlenecks';
  return {
    refresh: !has('--no-refresh'),
    view,
    device: val('--device', null),
    last: Number(val('--last', 15)),
  };
}

/**
 * Reduce unified rows to the headline numbers: row and device counts, total
 * cost, per-source cost split, and the ts span. Pure; exported for tests.
 */
export function summarize(rows) {
  const bySource = {};
  const devices = new Set();
  let firstTs = null;
  let lastTs = null;
  for (const r of rows) {
    bySource[r.source || 'unknown'] = (bySource[r.source || 'unknown'] || 0) + (r.cost_usd || 0);
    if (r.device_id) devices.add(r.device_id);
    const ts = String(r.ts || '');
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;
    }
  }
  const totalCost = Object.values(bySource).reduce((a, b) => a + b, 0);
  return { totalRows: rows.length, deviceCount: devices.size, totalCost, bySource, firstTs, lastTs };
}

/**
 * Run all six bottleneck detectors and return only the findings they flagged.
 * Pure; exported for tests.
 */
export function flaggedFindings(rows) {
  return [
    ...underSeededTasks(rows),
    ...wastedDispatches(rows),
    ...missingWarmServer(rows),
    ...wallTimeOutliers(rows),
    ...poorCacheReuse(rows),
    ...underDelegation(rows),
  ].filter((f) => f.flagged);
}

// --- output helpers (CLI-only, untested like scripts/ledger.mjs) -------------

const usd = (n) => (n || 0).toFixed(4);
const int = (n) => (n || 0).toLocaleString('en-US');

function printGroupTable(title, byMap) {
  console.log(`\n  ${title.padEnd(38)} runs   ok%      cost $      in tok     out tok    cache rd`);
  console.log('  ' + '-'.repeat(94));
  const rows = [...byMap.entries()].sort((a, b) => b[1].totalCost - a[1].totalCost);
  for (const [key, e] of rows) {
    // ok% only means something for opencode dispatches; Claude rows carry ok:null.
    const okPct = key.startsWith('claude/') || !e.count
      ? '-'
      : ((e.okCount / e.count) * 100).toFixed(0);
    console.log(
      `  ${key.padEnd(38)} ${String(e.count).padStart(4)}  ${String(okPct).padStart(4)}%  `
      + `${usd(e.totalCost).padStart(10)}  ${int(e.tokens.input).padStart(11)}  `
      + `${int(e.tokens.output).padStart(10)}  ${int(e.tokens.cache_read).padStart(10)}`,
    );
  }
  console.log();
}

function printBottlenecks(rows) {
  const findings = flaggedFindings(rows);
  if (!findings.length) {
    console.log('\n  no bottlenecks flagged.\n');
    return;
  }
  const byMetric = new Map();
  for (const f of findings) {
    const list = byMetric.get(f.metric) || [];
    list.push(f);
    byMetric.set(f.metric, list);
  }
  console.log(`\n  ${findings.length} flagged finding(s)\n`);
  for (const [metric, list] of byMetric) {
    console.log(`  ${metric}`);
    for (const f of list) {
      const thr = f.threshold == null ? '' : `  (threshold ${Number(f.threshold).toFixed(2)})`;
      console.log(
        `    ${String(f.group).padEnd(40)} ${Number(f.value).toFixed(3)}${thr}`,
      );
      console.log(`      ${JSON.stringify(f.evidence)}`);
    }
    console.log();
  }
}

function printRecent(rows, n) {
  const recent = rows.slice(-n);
  console.log('\n  when                 source    model                          cost $   device');
  console.log('  ' + '-'.repeat(88));
  for (const r of recent) {
    const when = String(r.ts || '').slice(0, 16).replace('T', ' ');
    console.log(
      `  ${when.padEnd(20)} ${String(r.source || '').padEnd(9)} `
      + `${String(r.model || '').padEnd(28)} ${usd(r.cost_usd).padStart(9)}   ${r.device_id || ''}`,
    );
  }
  console.log();
}

// --- main ------------------------------------------------------------------

function main(argv) {
  const opts = parseArgs(argv);

  if (opts.refresh) {
    const { deviceId, rowCount } = writeLocalSnapshot();
    console.log(`\n  refreshed snapshot for "${deviceId}" (${rowCount} row)`);
  }

  const { usageDir } = resolvePaths();
  let rows = readAllDeviceSnapshots(usageDir);
  if (opts.device) rows = rows.filter((r) => r.device_id === opts.device);

  if (!rows.length) {
    console.log('\n  no usage rows yet — run scripts/usage-snapshot.mjs on each device, then commit usage/.\n');
    return;
  }

  rows.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));

  const s = summarize(rows);
  const split = Object.entries(s.bySource)
    .map(([k, v]) => `${k} $${usd(v)}`)
    .join(' / ');
  console.log(
    `\n  ${int(s.totalRows)} row(s) across ${s.deviceCount} device(s), $${usd(s.totalCost)} total  (${split})`,
  );
  if (s.firstTs) console.log(`  ${s.firstTs.slice(0, 10)} .. ${s.lastTs.slice(0, 10)}`);

  if (opts.view === 'by-model') return printGroupTable('source / model', byModel(rows));
  if (opts.view === 'by-repo') return printGroupTable('source / repo', byRepo(rows));
  if (opts.view === 'by-day') return printGroupTable('source / day', byDay(rows));
  if (opts.view === 'bottlenecks') return printBottlenecks(rows);
  return printRecent(rows, opts.last);
}

// Run as a script; stay quiet when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
