/**
 * bin/lib/claude-usage.mjs — pure helpers for reading Claude Code transcripts.
 *
 * Keeps file-system access and parsing separate so callers can be tested
 * without touching ~/.claude/projects. Only lines with type === 'assistant'
 * and a present message.usage carry token data.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Read a Claude Code session transcript and extract usage rows.
 *
 * Each non-empty line is JSON-parsed inside try/catch; unparseable lines are
 * skipped silently. Returns an array of normalized objects, one per assistant
 * message with usage data.
 */
export function parseClaudeTranscript(filePath) {
  const text = readFileSync(filePath, 'utf8');
  return String(text || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((line) => (
      line &&
      line.type === 'assistant' &&
      line.message &&
      line.message.usage
    ))
    .map((line) => ({
      ts: line.timestamp,
      session_id: line.sessionId,
      model: line.message.model,
      repo: path.basename(line.cwd || ''),
      branch: line.gitBranch ?? null,
      effort: line.effort ?? null,
      usage: line.message.usage,
    }));
}

/**
 * Discover Claude Code transcript files under a projects directory.
 *
 * Scans one level of project-slug subdirectories and returns the absolute
 * paths of direct-child .jsonl files only. This deliberately does not recurse
 * into subdirectories such as <uuid>/subagents/ which hold nested subagent
 * transcripts and are out of scope for this pass.
 */
export function discoverClaudeTranscripts(claudeProjectsDir) {
  const results = [];
  const projects = readdirSync(claudeProjectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const project of projects) {
    const projectDir = path.join(claudeProjectsDir, project);
    const entries = readdirSync(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(path.join(projectDir, entry.name));
      }
    }
  }

  return results;
}
