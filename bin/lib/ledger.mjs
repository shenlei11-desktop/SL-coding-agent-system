/**
 * bin/lib/ledger.mjs — pure helpers for scripts/ledger.mjs.
 *
 * Kept separate so the parts that decide *what* a ledger summary shows — parsing
 * the jsonl rows, grouping by model — can be unit-tested without reading files or
 * printing anything. scripts/ledger.mjs owns the CLI and output; this file is all
 * pure functions.
 */

/**
 * Parse ledger.jsonl text into row objects. Tolerates missing optional fields by
 * filtering out unparseable lines (a half-written row from a crash must not break
 * the summary). Returns [] for empty input.
 */
export function parseOpencodeLedger(text) {
  return String(text || '')
    .split('\n')
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/**
 * Group parsed ledger rows by model and accumulate the stats the --by-model table
 * shows: run count, pass count, total cost, total wall time, stray-file count, and
 * how many ok runs wrote zero files. Returns a Map keyed by model name (or
 * 'unknown' when the row has no model).
 */
export function aggregateByModel(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.model || 'unknown';
    const e = by.get(k) || { runs: 0, ok: 0, cost: 0, wall: 0, strays: 0, noWrite: 0 };
    e.runs++; if (r.ok) e.ok++;
    e.cost += r.cost || 0; e.wall += r.wall_s || 0;
    e.strays += (r.out_of_scope || []).length;
    if (r.ok && !(r.touched || r.changed || []).length) e.noWrite++;
    by.set(k, e);
  }
  return by;
}

/**
 * Group parsed ledger rows by repo and accumulate the same stats as
 * aggregateByModel. Returns a Map keyed by repo name (or 'unknown' when
 * the row has no repo).
 */
export function aggregateByRepo(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.repo || 'unknown';
    const e = by.get(k) || { runs: 0, ok: 0, cost: 0, wall: 0, strays: 0, noWrite: 0 };
    e.runs++; if (r.ok) e.ok++;
    e.cost += r.cost || 0; e.wall += r.wall_s || 0;
    e.strays += (r.out_of_scope || []).length;
    if (r.ok && !(r.touched || r.changed || []).length) e.noWrite++;
    by.set(k, e);
  }
  return by;
}

/**
 * Group parsed ledger rows by branch and accumulate the same stats as
 * aggregateByModel. Returns a Map keyed by branch name (or 'unknown' when
 * the row has no branch).
 */
export function aggregateByBranch(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.branch || 'unknown';
    const e = by.get(k) || { runs: 0, ok: 0, cost: 0, wall: 0, strays: 0, noWrite: 0 };
    e.runs++; if (r.ok) e.ok++;
    e.cost += r.cost || 0; e.wall += r.wall_s || 0;
    e.strays += (r.out_of_scope || []).length;
    if (r.ok && !(r.touched || r.changed || []).length) e.noWrite++;
    by.set(k, e);
  }
  return by;
}
