/**
 * bin/lib/usage-device.mjs — per-device usage snapshot helpers.
 *
 * sanitizeDeviceId, resolveDeviceId, and buildDeviceSnapshot are pure and take
 * fake env/hostnameFn/row inputs in tests, so the bulk of this file's logic is
 * still testable without touching the real environment or disk.
 * writeDeviceSnapshot and readAllDeviceSnapshots are the filesystem edges.
 */

import { hostname as osHostname } from 'node:os';
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normalizeOpencodeRow, normalizeClaudeRow } from './usage-normalize.mjs';

/**
 * Turn a raw hostname (or any user-supplied label) into a filesystem-safe
 * device id: lowercase, only [a-z0-9-], no runs of '-', no leading/trailing
 * '-'. Returns 'unknown-device' when the input collapses to nothing.
 */
export function sanitizeDeviceId(hostname) {
  const cleaned = String(hostname || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'unknown-device';
}

/**
 * Resolve the device id for this run. Honours AGENT_DEVICE_ID when set so a
 * user can override the hostname-derived id (useful when one machine answers
 * to several names, or when tagging a container). env and hostnameFn are
 * parameters with documented defaults so tests can inject fakes without
 * touching the real environment or OS.
 */
export function resolveDeviceId(
  env = process.env,
  hostnameFn = osHostname
) {
  const raw = env.AGENT_DEVICE_ID;
  if (raw && String(raw).trim() !== '') {
    return sanitizeDeviceId(raw);
  }
  return sanitizeDeviceId(hostnameFn());
}

/**
 * Build the array of unified rows that will be written to this device's
 * usage/<device-id>.jsonl file.
 *
 * - opencodeLedgerRows (from parseOpencodeLedger) map one-to-one through
 *   normalizeOpencodeRow — one unified row per dispatch, no rollup.
 * - claudeTranscriptRows (from parseClaudeTranscript, shaped
 *   {ts, session_id, model, repo, branch, effort, usage}) are rolled up to
 *   ONE row per (session_id, model) pair: token fields are summed across the
 *   turns in the group, and ts/repo/branch/effort come from the earliest-ts
 *   row in the group (session start under that model). The rolled-up totals
 *   are fed through normalizeClaudeRow via a synthetic raw row so cost
 *   computation and the unified shape stay consistent with the per-turn path.
 *
 * Returns opencode rows first, then claude rows, unsorted — the caller
 * decides ordering when it writes the file.
 */
export function buildDeviceSnapshot({ opencodeLedgerRows, claudeTranscriptRows, deviceId }) {
  const opencodeRows = (opencodeLedgerRows || []).map((r) =>
    normalizeOpencodeRow(r, deviceId)
  );

  const groups = new Map();
  for (const r of claudeTranscriptRows || []) {
    const key = `${r.session_id ?? ''}\u0000${r.model ?? ''}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        earliest: r,
        usage: {
          input_tokens: r.usage?.input_tokens ?? 0,
          output_tokens: r.usage?.output_tokens ?? 0,
          cache_creation_input_tokens: r.usage?.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: r.usage?.cache_read_input_tokens ?? 0,
        },
      });
      continue;
    }
    const u = r.usage || {};
    existing.usage.input_tokens += u.input_tokens ?? 0;
    existing.usage.output_tokens += u.output_tokens ?? 0;
    existing.usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
    existing.usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
    if (String(r.ts || '') < String(existing.earliest.ts || '')) {
      existing.earliest = r;
    }
  }

  const claudeRows = [];
  for (const { earliest, usage } of groups.values()) {
    const synthetic = {
      ts: earliest.ts,
      session_id: earliest.session_id,
      model: earliest.model,
      repo: earliest.repo,
      branch: earliest.branch,
      effort: earliest.effort,
      usage,
    };
    claudeRows.push(normalizeClaudeRow(synthetic, deviceId));
  }

  return [...opencodeRows, ...claudeRows];
}

/**
 * Write rows to filePath as JSONL text. Overwrites any existing file contents.
 * Creates the parent directory if it does not already exist.
 */
export function writeDeviceSnapshot(filePath, rows) {
  mkdirSync(dirname(filePath), { recursive: true });
  const text = (rows || []).map((r) => JSON.stringify(r)).join('\n');
  writeFileSync(filePath, text ? `${text}\n` : '', 'utf8');
}

/**
 * Read every *.jsonl file directly inside usageDir and return all parsed rows
 * concatenated into one array. Tolerates a missing directory, unreadable files,
 * and individual malformed lines (each is skipped silently).
 */
export function readAllDeviceSnapshots(usageDir) {
  if (!existsSync(usageDir)) return [];
  const files = readdirSync(usageDir).filter((f) => f.endsWith('.jsonl'));
  const all = [];
  for (const f of files) {
    try {
      const text = readFileSync(join(usageDir, f), 'utf8');
      const rows = String(text || '')
        .split('\n')
        .filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
      all.push(...rows);
    } catch {
      // skip unreadable or malformed file
    }
  }
  return all;
}
