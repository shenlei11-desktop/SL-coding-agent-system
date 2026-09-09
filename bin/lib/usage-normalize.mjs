/**
 * bin/lib/usage-normalize.mjs — pure helpers that unify opencode ledger rows
 * and Claude Code transcript rows into a single row shape.
 *
 * Kept separate from the readers (ledger.mjs, claude-usage.mjs) and the
 * pricer (pricing.mjs) so the merge logic can be tested in isolation without
 * touching the filesystem or printing anything.
 */

import { computeClaudeCost } from './pricing.mjs';

/**
 * Normalize one opencode ledger row into the unified row shape.
 *
 * The opencode ledger never carries token counts, so every tokens field is
 * null. Missing optional fields fall back to the documented defaults so a
 * half-written row from a crash still produces a usable unified row.
 */
export function normalizeOpencodeRow(r, deviceId) {
  return {
    ts: r.ts,
    source: 'opencode',
    device_id: deviceId,
    repo: r.repo,
    branch: r.branch ?? null,
    model: r.model,
    tokens: { input: null, output: null, cache_write: null, cache_read: null },
    cost_usd: r.cost ?? 0,
    ok: r.ok ?? null,
    ext: {
      agent: r.agent,
      steps: r.steps ?? 0,
      wall_s: r.wall_s ?? 0,
      attached: r.attached ?? null,
      touched: (r.touched || r.changed || []).length,
      out_of_scope: (r.out_of_scope || []).length,
      session: r.session ?? null,
    },
  };
}

/**
 * Normalize one Claude Code transcript row into the unified row shape.
 *
 * Token fields come straight from the usage object; cost is computed via
 * pricing.mjs so rate changes stay in one place. If the model is unknown
 * to the pricer, computeClaudeCost returns null and we fall back to 0.
 */
export function normalizeClaudeRow(r, deviceId) {
  return {
    ts: r.ts,
    source: 'claude',
    device_id: deviceId,
    repo: r.repo,
    branch: r.branch,
    model: r.model,
    tokens: {
      input: r.usage?.input_tokens ?? 0,
      output: r.usage?.output_tokens ?? 0,
      cache_write: r.usage?.cache_creation_input_tokens ?? 0,
      cache_read: r.usage?.cache_read_input_tokens ?? 0,
    },
    cost_usd: computeClaudeCost(r.model, r.usage) ?? 0,
    ok: null,
    ext: {
      session_id: r.session_id,
      effort: r.effort ?? null,
    },
  };
}

/**
 * Merge opencode and claude unified rows into a single array sorted ascending
 * by ts. ts values are ISO timestamp strings, so simple string comparison
 * gives the correct chronological order.
 */
export function mergeSources(opencodeRows, claudeRows) {
  return [...opencodeRows, ...claudeRows].sort((a, b) =>
    String(a.ts || '').localeCompare(String(b.ts || ''))
  );
}
