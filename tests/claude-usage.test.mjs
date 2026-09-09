import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseClaudeTranscript, discoverClaudeTranscripts } from '../bin/lib/claude-usage.mjs';

// --- parseClaudeTranscript --------------------------------------------------------

test('parseClaudeTranscript: one normalized row per assistant line with usage; user and unparseable lines skipped', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cu-'));
  try {
    const file = path.join(dir, 'session.jsonl');
    const assistant = {
      type: 'assistant',
      timestamp: '2026-08-22T10:31:16.272Z',
      sessionId: 'abc123',
      gitBranch: 'main',
      cwd: 'C:\\Users\\USER\\OneDrive\\Desktop\\SL-coding-agent-system',
      effort: 'high',
      message: {
        model: 'claude-opus-5',
        usage: {
          input_tokens: 2,
          cache_creation_input_tokens: 14771,
          cache_read_input_tokens: 23714,
          output_tokens: 1342,
        },
      },
    };
    const user = {
      type: 'user',
      timestamp: '2026-08-22T10:31:02.000Z',
      sessionId: 'abc123',
      message: { role: 'user', content: 'list the repo layout' },
    };
    writeFileSync(file, [
      JSON.stringify(assistant),
      JSON.stringify(user),
      '{ not json ',
    ].join('\n') + '\n');

    const rows = parseClaudeTranscript(file);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      ts: '2026-08-22T10:31:16.272Z',
      session_id: 'abc123',
      model: 'claude-opus-5',
      repo: 'SL-coding-agent-system',
      branch: 'main',
      effort: 'high',
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 14771,
        cache_read_input_tokens: 23714,
        output_tokens: 1342,
      },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- discoverClaudeTranscripts ----------------------------------------------------

test('discoverClaudeTranscripts: direct-child .jsonl per project dir only, never nested subagent transcripts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cu-'));
  try {
    const projA = path.join(root, 'proj-a');
    const projB = path.join(root, 'proj-b');
    const subagents = path.join(projB, 'd4e5f6', 'subagents');
    mkdirSync(projA, { recursive: true });
    mkdirSync(subagents, { recursive: true });
    writeFileSync(path.join(projA, 'a1b2c3.jsonl'), '{}\n');
    writeFileSync(path.join(projB, 'd4e5f6.jsonl'), '{}\n');
    writeFileSync(path.join(subagents, 'nested.jsonl'), '{}\n');

    const found = discoverClaudeTranscripts(root).sort();
    assert.deepEqual(found, [
      path.join(projA, 'a1b2c3.jsonl'),
      path.join(projB, 'd4e5f6.jsonl'),
    ].sort());
    assert.ok(!found.includes(path.join(subagents, 'nested.jsonl')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
