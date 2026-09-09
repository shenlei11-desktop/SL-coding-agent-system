import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

import {
  resolvePaths,
  collectOpencodeRows,
  collectClaudeRows,
  writeLocalSnapshot,
} from '../scripts/usage-snapshot.mjs';
import { readAllDeviceSnapshots } from '../bin/lib/usage-device.mjs';

// A minimal Claude transcript line in the shape parseClaudeTranscript expects.
function assistantLine({ ts, sessionId, model, cwd, usage }) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    sessionId,
    cwd,
    gitBranch: 'main',
    effort: 'medium',
    message: { model, usage },
  });
}

// --- resolvePaths -----------------------------------------------------------

test('resolvePaths: env overrides are honoured for all three paths', () => {
  const env = {
    AGENT_STATE_DIR: path.join('/fake', 'state'),
    CLAUDE_PROJECTS_DIR: path.join('/fake', 'projects'),
    AGENT_USAGE_DIR: path.join('/fake', 'usage'),
  };
  const { ledgerPath, claudeProjectsDir, usageDir } = resolvePaths(env);
  assert.equal(ledgerPath, path.join('/fake', 'state', 'ledger.jsonl'));
  assert.equal(claudeProjectsDir, path.join('/fake', 'projects'));
  assert.equal(usageDir, path.join('/fake', 'usage'));
});

test('resolvePaths: unset env falls back to home-directory defaults', () => {
  const { ledgerPath, claudeProjectsDir, usageDir } = resolvePaths({});
  assert.equal(ledgerPath, path.join(homedir(), '.agent-system', 'state', 'ledger.jsonl'));
  assert.equal(claudeProjectsDir, path.join(homedir(), '.claude', 'projects'));
  // usageDir resolves to <repo-root>/usage — assert on the basename, not the
  // absolute path, so the test survives a checkout at any location.
  assert.equal(path.basename(usageDir), 'usage');
});

// --- collectOpencodeRows --------------------------------------------------

test('collectOpencodeRows: a missing ledger file returns an empty array', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'usage-snap-'));
  try {
    assert.deepEqual(collectOpencodeRows(path.join(dir, 'ledger.jsonl')), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('collectOpencodeRows: an existing ledger is parsed into rows, malformed lines skipped', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'usage-snap-'));
  try {
    const p = path.join(dir, 'ledger.jsonl');
    writeFileSync(p,
      `${JSON.stringify({ ts: '2026-08-22T09:00:00.000Z', repo: 'r', model: 'glm-5.2', cost: 0.01, ok: true })}\n`
      + 'not json at all\n'
      + `${JSON.stringify({ ts: '2026-08-22T09:05:00.000Z', repo: 'r', model: 'glm-5.2', cost: 0.02, ok: false })}\n`);
    const rows = collectOpencodeRows(p);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].model, 'glm-5.2');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- collectClaudeRows ---------------------------------------------------

test('collectClaudeRows: a missing projects directory returns an empty array', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'usage-snap-'));
  try {
    assert.deepEqual(collectClaudeRows(path.join(dir, 'no-projects')), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('collectClaudeRows: transcripts under project dirs are discovered and parsed; a malformed transcript is skipped', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'usage-snap-'));
  try {
    const projects = path.join(dir, 'projects');
    const projA = path.join(projects, 'repo-a-slug');
    mkdirSync(projA, { recursive: true });
    writeFileSync(path.join(projA, 'sess-a.jsonl'), assistantLine({
      ts: '2026-08-22T10:00:00.000Z',
      sessionId: 'sess-a',
      model: 'claude-opus-5',
      cwd: '/work/repo-a',
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }) + '\n');
    // A second transcript that is not valid JSON on any line — parseClaudeTranscript
    // skips its lines rather than throwing, so it simply contributes nothing.
    writeFileSync(path.join(projA, 'sess-broken.jsonl'), '{ not json\nalso not json\n');

    const rows = collectClaudeRows(projects);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].session_id, 'sess-a');
    assert.equal(rows[0].model, 'claude-opus-5');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- writeLocalSnapshot ------------------------------------------------

// Build a fake home layout: a ledger, a claude projects tree, and an empty
// usage output dir, all under one temp root, wired through an env object.
function fakeEnv(root, { deviceId = 'test-device', ledger, transcripts = [] } = {}) {
  const stateDir = path.join(root, 'state');
  const projectsDir = path.join(root, 'projects');
  const usageDir = path.join(root, 'usage');
  mkdirSync(stateDir, { recursive: true });

  if (ledger) {
    writeFileSync(path.join(stateDir, 'ledger.jsonl'),
      ledger.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  for (const t of transcripts) {
    const projDir = path.join(projectsDir, t.project);
    mkdirSync(projDir, { recursive: true });
    writeFileSync(path.join(projDir, `${t.sessionId}.jsonl`),
      assistantLine(t) + '\n');
  }

  return {
    AGENT_DEVICE_ID: deviceId,
    AGENT_STATE_DIR: stateDir,
    CLAUDE_PROJECTS_DIR: projectsDir,
    AGENT_USAGE_DIR: usageDir,
  };
}

test('writeLocalSnapshot: merges both sources into usage/<device-id>.jsonl, rows sorted ascending by ts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'usage-snap-'));
  try {
    const env = fakeEnv(root, {
      deviceId: 'box-1',
      ledger: [
        { ts: '2026-08-22T12:00:00.000Z', repo: 'r', model: 'glm-5.2', cost: 0.03, ok: true },
      ],
      transcripts: [
        {
          project: 'r-slug',
          sessionId: 'sess-1',
          ts: '2026-08-22T08:00:00.000Z',
          model: 'claude-opus-5',
          cwd: '/work/r',
          usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      ],
    });

    const result = writeLocalSnapshot({ env });
    assert.equal(result.deviceId, 'box-1');
    assert.equal(result.rowCount, 2);
    assert.equal(result.opencodeRows, 1);
    assert.equal(result.claudeRows, 1);
    assert.equal(path.basename(result.filePath), 'box-1.jsonl');

    const rows = readAllDeviceSnapshots(path.join(root, 'usage'));
    assert.equal(rows.length, 2);
    // The claude row (08:00) sorts before the opencode row (12:00) even though
    // buildDeviceSnapshot returns opencode rows first.
    assert.equal(rows[0].source, 'claude');
    assert.equal(rows[1].source, 'opencode');
    assert.ok(rows[0].ts < rows[1].ts);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeLocalSnapshot: both sources absent still writes an empty snapshot file, rowCount 0, no throw', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'usage-snap-'));
  try {
    // No ledger, no transcripts written.
    const env = fakeEnv(root, { deviceId: 'empty-box' });
    const result = writeLocalSnapshot({ env });
    assert.equal(result.rowCount, 0);
    assert.equal(result.opencodeRows, 0);
    assert.equal(result.claudeRows, 0);
    assert.ok(existsSync(result.filePath));
    assert.deepEqual(readAllDeviceSnapshots(path.join(root, 'usage')), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeLocalSnapshot: a second run fully overwrites the previous snapshot', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'usage-snap-'));
  try {
    const base = {
      deviceId: 'rerun-box',
      transcripts: [
        {
          project: 'r-slug',
          sessionId: 'sess-1',
          ts: '2026-08-22T08:00:00.000Z',
          model: 'claude-opus-5',
          cwd: '/work/r',
          usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      ],
    };
    writeLocalSnapshot({ env: fakeEnv(root, base) });

    // Second run with an added ledger row: the file must reflect exactly the
    // second run's rows, not the union of both runs.
    const env2 = fakeEnv(root, {
      ...base,
      ledger: [{ ts: '2026-08-22T09:00:00.000Z', repo: 'r', model: 'glm-5.2', cost: 0.01, ok: true }],
    });
    const result = writeLocalSnapshot({ env: env2 });
    assert.equal(result.rowCount, 2);

    const rows = readAllDeviceSnapshots(path.join(root, 'usage'));
    assert.equal(rows.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
