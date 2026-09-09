#!/usr/bin/env node
/**
 * usage-serve.mjs — a live local usage dashboard.
 *
 * Starts a zero-dependency HTTP server on 127.0.0.1 that serves one
 * self-contained HTML page (scripts/usage-dashboard.html). The page polls
 * /api/data; each poll rebuilds THIS device's snapshot (writeLocalSnapshot),
 * re-reads every committed usage/<device-id>.jsonl, and returns the same
 * aggregates the CLI prints — so the page reflects local activity within one
 * poll interval and picks up other devices whenever their snapshots are pulled.
 *
 *   node scripts/usage-serve.mjs         # then open the printed URL
 *
 * Port: AGENT_USAGE_PORT (default 7676). Foreground; Ctrl+C to stop.
 *
 * buildPayload is exported and pure so the shape the page depends on is
 * unit-tested without starting a server.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readAllDeviceSnapshots } from '../bin/lib/usage-device.mjs';
import { byModel, byRepo, byDay } from '../bin/lib/usage-aggregate.mjs';
import { resolvePaths, writeLocalSnapshot } from './usage-snapshot.mjs';
import { summarize, flaggedFindings } from './usage.mjs';

const HTML_FILE = path.join(fileURLToPath(new URL('.', import.meta.url)), 'usage-dashboard.html');
const PORT = Number(process.env.AGENT_USAGE_PORT || 7676);

/**
 * Collapse a byModel/byRepo Map (keyed "<source>/<name>") into one row per
 * name carrying the claude and opencode cost split plus run totals. Sorted by
 * total cost, descending.
 */
function pivotBySource(byMap) {
  const out = new Map();
  for (const [key, e] of byMap) {
    const slash = key.indexOf('/');
    const source = key.slice(0, slash);
    const name = key.slice(slash + 1);
    const row = out.get(name) || {
      name, claude: 0, opencode: 0, total: 0, runs: 0, okRuns: 0,
      tokensIn: 0, tokensOut: 0, cacheRead: 0,
    };
    if (source === 'claude') row.claude += e.totalCost;
    else if (source === 'opencode') row.opencode += e.totalCost;
    row.total += e.totalCost;
    row.runs += e.count;
    row.okRuns += e.okCount;
    row.tokensIn += e.tokens.input;
    row.tokensOut += e.tokens.output;
    row.cacheRead += e.tokens.cache_read;
    out.set(name, row);
  }
  return [...out.values()].sort((a, b) => b.total - a.total);
}

/**
 * Re-pivot the byDay Map into one row per calendar day with the claude and
 * opencode cost split. Sorted by day, ascending.
 */
function pivotByDay(byMap) {
  const out = new Map();
  for (const [key, e] of byMap) {
    const slash = key.indexOf('/');
    const source = key.slice(0, slash);
    const day = key.slice(slash + 1);
    const row = out.get(day) || { day, claude: 0, opencode: 0, total: 0 };
    if (source === 'claude') row.claude += e.totalCost;
    else if (source === 'opencode') row.opencode += e.totalCost;
    row.total += e.totalCost;
    out.set(day, row);
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Build the full JSON payload the dashboard page renders. Pure — takes unified
 * rows, returns a plain object.
 */
export function buildPayload(rows) {
  const sorted = [...rows].sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  return {
    generatedAt: new Date().toISOString(),
    summary: summarize(sorted),
    byRepo: pivotBySource(byRepo(sorted)),
    byModel: pivotBySource(byModel(sorted)),
    byDay: pivotByDay(byDay(sorted)),
    bottlenecks: flaggedFindings(sorted).map((f) => ({
      metric: f.metric,
      group: f.group,
      value: f.value,
      threshold: f.threshold,
      evidence: f.evidence,
    })),
  };
}

/**
 * Refresh the local snapshot (best effort) and assemble the payload from every
 * device's committed snapshot.
 */
function readAndBuild() {
  let refresh = null;
  try {
    refresh = writeLocalSnapshot();
  } catch (e) {
    refresh = { error: String(e && e.message || e) };
  }
  const { usageDir } = resolvePaths();
  const rows = readAllDeviceSnapshots(usageDir);
  return { ...buildPayload(rows), refresh };
}

function start() {
  const server = createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      try {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(readFileSync(HTML_FILE, 'utf8'));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(`could not read ${HTML_FILE}: ${e.message}`);
      }
      return;
    }
    if (url === '/api/data') {
      try {
        const body = JSON.stringify(readAndBuild());
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(e && e.message || e) }));
      }
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  usage dashboard  ->  http://localhost:${PORT}`);
    console.log('  refreshes this device on every poll · Ctrl+C to stop\n');
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}
