#!/usr/bin/env node
/**
 * install.mjs — deploy this repo's configuration to the machine.
 *
 * The repo is the source of truth. This copies into the live locations, backing up
 * whatever it replaces first. Idempotent: safe to re-run after editing the sources.
 *
 *   node scripts/install.mjs [--dry-run] [--force]
 *
 * Deploys:
 *   config/opencode.jsonc  ->  ~/.config/opencode/opencode.jsonc
 *   claude/CLAUDE.md       ->  ~/.claude/CLAUDE.md
 *   claude/skills/<name>/  ->  ~/.claude/skills/<name>/
 *
 * Backups go to ~/.agent-system/backups/<timestamp>/ with the original layout, so a
 * bad deploy can be reversed by copying the tree back.
 */

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const HOME = homedir();

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP_DIR = path.join(HOME, '.agent-system', 'backups', STAMP);

const actions = [];

function planFile(src, dest) {
  if (!existsSync(src)) return;
  const exists = existsSync(dest);
  let changed = true;
  if (exists) {
    try { changed = readFileSync(src, 'utf8') !== readFileSync(dest, 'utf8'); } catch { changed = true; }
  }
  actions.push({ type: 'file', src, dest, exists, changed });
}

function planDir(srcDir, destDir) {
  if (!existsSync(srcDir)) return;
  for (const entry of readdirSync(srcDir)) {
    const s = path.join(srcDir, entry);
    const d = path.join(destDir, entry);
    if (statSync(s).isDirectory()) planDir(s, d);
    else planFile(s, d);
  }
}

// --- what gets deployed ----------------------------------------------------
planFile(path.join(REPO, 'config', 'opencode.jsonc'), path.join(HOME, '.config', 'opencode', 'opencode.jsonc'));
planFile(path.join(REPO, 'claude', 'CLAUDE.md'), path.join(HOME, '.claude', 'CLAUDE.md'));
planDir(path.join(REPO, 'claude', 'skills'), path.join(HOME, '.claude', 'skills'));

// --- report ----------------------------------------------------------------
const toWrite = actions.filter((a) => a.changed || force);
const unchanged = actions.length - toWrite.length;

console.log(`\nagent-system installer`);
console.log(`  source: ${REPO}`);
console.log(`  ${actions.length} file(s) managed, ${toWrite.length} to write, ${unchanged} already current\n`);

for (const a of toWrite) {
  const verb = a.exists ? 'replace' : 'create ';
  console.log(`  ${verb}  ${a.dest.replace(HOME, '~')}`);
}

if (!toWrite.length) { console.log('  nothing to do.\n'); process.exit(0); }

if (dryRun) {
  console.log(`\n  --dry-run: nothing written.\n`);
  process.exit(0);
}

// --- back up, then write ---------------------------------------------------
let backedUp = 0;
for (const a of toWrite) {
  if (!a.exists) continue;
  const rel = path.relative(HOME, a.dest);
  const bak = path.join(BACKUP_DIR, rel);
  mkdirSync(path.dirname(bak), { recursive: true });
  copyFileSync(a.dest, bak);
  backedUp++;
}

for (const a of toWrite) {
  mkdirSync(path.dirname(a.dest), { recursive: true });
  copyFileSync(a.src, a.dest);
}

// State dir lives outside ~/.claude on purpose: opencode ingests instruction files
// from there, and orchestration state must not be reachable as an instruction.
mkdirSync(path.join(HOME, '.agent-system', 'state'), { recursive: true });

console.log(`\n  wrote ${toWrite.length} file(s).`);
if (backedUp) console.log(`  backed up ${backedUp} replaced file(s) to ${BACKUP_DIR.replace(HOME, '~')}`);
console.log(`\n  next: node bin/serve.mjs start   # warm server, optional but removes boot latency\n`);
