#!/usr/bin/env node
/**
 * usage-snapshot.mjs — rebuild THIS device's usage snapshot.
 *
 * Reads the two local sources — the opencode ledger
 * (~/.agent-system/state/ledger.jsonl, same path scripts/ledger.mjs uses) and
 * the Claude Code transcripts under ~/.claude/projects — normalises them into
 * one unified row shape via bin/lib/usage-device.mjs, and writes the result to
 * usage/<device-id>.jsonl at the repo root. Full overwrite, so re-running is
 * idempotent.
 *
 * The snapshot files are committed: each device writes its own
 * usage/<device-id>.jsonl and a `git pull` is how the report command
 * (scripts/usage.mjs) sees every other device. Rows are sorted ascending by ts
 * before writing so a re-run produces a minimal diff.
 *
 *   node scripts/usage-snapshot.mjs
 *
 * writeLocalSnapshot() is exported so scripts/usage.mjs can refresh this
 * device before it aggregates.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseOpencodeLedger } from '../bin/lib/ledger.mjs';
import { discoverClaudeTranscripts, parseClaudeTranscript } from '../bin/lib/claude-usage.mjs';
import { resolveDeviceId, buildDeviceSnapshot, writeDeviceSnapshot } from '../bin/lib/usage-device.mjs';

const REPO_ROOT = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Resolve the three source/target paths from an env object. AGENT_STATE_DIR and
 * CLAUDE_PROJECTS_DIR let tests point at fixtures without touching the real home
 * directory; AGENT_USAGE_DIR overrides the committed in-repo target the same way
 * AGENT_STATE_DIR overrides the ledger location for scripts/ledger.mjs.
 */
export function resolvePaths(env = process.env) {
  const stateDir = env.AGENT_STATE_DIR || path.join(homedir(), '.agent-system', 'state');
  const claudeProjectsDir = env.CLAUDE_PROJECTS_DIR || path.join(homedir(), '.claude', 'projects');
  const usageDir = env.AGENT_USAGE_DIR || path.join(REPO_ROOT, 'usage');
  return { ledgerPath: path.join(stateDir, 'ledger.jsonl'), claudeProjectsDir, usageDir };
}

/**
 * Read the opencode ledger, tolerating its absence (no dispatch has run on this
 * device yet) and an unreadable file. Returns [] in both cases.
 */
export function collectOpencodeRows(ledgerPath) {
  if (!existsSync(ledgerPath)) return [];
  try {
    return parseOpencodeLedger(readFileSync(ledgerPath, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Discover and parse every Claude Code transcript under claudeProjectsDir.
 * Tolerates a missing projects directory and skips any individual transcript
 * that cannot be read or parsed.
 */
export function collectClaudeRows(claudeProjectsDir) {
  if (!existsSync(claudeProjectsDir)) return [];
  let files;
  try {
    files = discoverClaudeTranscripts(claudeProjectsDir);
  } catch {
    return [];
  }
  const rows = [];
  for (const f of files) {
    try {
      rows.push(...parseClaudeTranscript(f));
    } catch {
      // skip an unreadable or mid-write transcript
    }
  }
  return rows;
}

/**
 * Rebuild this device's snapshot from local sources and write it to
 * usage/<device-id>.jsonl. Overwrites any existing file. Returns
 * { deviceId, filePath, rowCount, opencodeRows, claudeRows } so a caller can
 * report what it found.
 */
export function writeLocalSnapshot({ env = process.env } = {}) {
  const { ledgerPath, claudeProjectsDir, usageDir } = resolvePaths(env);
  const deviceId = resolveDeviceId(env);

  const opencodeLedgerRows = collectOpencodeRows(ledgerPath);
  const claudeTranscriptRows = collectClaudeRows(claudeProjectsDir);

  const rows = buildDeviceSnapshot({ opencodeLedgerRows, claudeTranscriptRows, deviceId })
    .sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));

  const filePath = path.join(usageDir, `${deviceId}.jsonl`);
  writeDeviceSnapshot(filePath, rows);

  return {
    deviceId,
    filePath,
    rowCount: rows.length,
    opencodeRows: opencodeLedgerRows.length,
    claudeRows: claudeTranscriptRows.length,
  };
}

// Run as a script (but not when imported by scripts/usage.mjs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { deviceId, filePath, rowCount, opencodeRows, claudeRows } = writeLocalSnapshot();
  const rel = path.relative(process.cwd(), filePath);
  console.log(`\n  device "${deviceId}": ${rowCount} row(s) -> ${rel}`);
  console.log(`  sources: ${opencodeRows} opencode ledger row(s), ${claudeRows} Claude transcript row(s)`);
  if (opencodeRows === 0 && claudeRows === 0) {
    console.log('  (both sources empty or absent — wrote an empty snapshot)');
  }
  console.log();
}
