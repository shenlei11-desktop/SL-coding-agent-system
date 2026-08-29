#!/usr/bin/env node
/**
 * doctor.mjs — check the system is wired up correctly.
 *
 * Each check corresponds to something that has actually gone wrong on this machine.
 * Run after install, or when a dispatch behaves strangely.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOpencodeBin } from '../bin/lib/resolve-opencode.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const HOME = homedir();
const STATE_DIR = process.env.AGENT_STATE_DIR || path.join(HOME, '.agent-system', 'state');

const OPENCODE = resolveOpencodeBin();

let failures = 0;
let warnings = 0;

function ok(msg)   { console.log(`  ok    ${msg}`); }
function warn(msg) { console.log(`  warn  ${msg}`); warnings++; }
function bad(msg)  { console.log(`  FAIL  ${msg}`); failures++; }

console.log('\nagent-system doctor\n');

// 1. The delegate binary itself. Spawning the .cmd shim fails on Node >=20.
if (existsSync(OPENCODE)) ok(`opencode binary present`);
else bad(`opencode binary not found at ${OPENCODE} — set OPENCODE_BIN`);

// 2. Config deployed, and carrying the settings that prevent known failure modes.
const cfgPath = path.join(HOME, '.config', 'opencode', 'opencode.jsonc');
if (!existsSync(cfgPath)) {
  bad('opencode config not deployed — run: npm run install:system');
} else {
  const raw = readFileSync(cfgPath, 'utf8');
  ok('opencode config deployed');

  // A denied tool call used to hard-stop the run with no output at all.
  if (/continue_loop_on_deny"\s*:\s*true/.test(raw)) ok('continue_loop_on_deny enabled');
  else warn('continue_loop_on_deny not enabled — a denied tool call can abort a run');

  for (const agent of ['t1-scribe', 't2-build', 't3-architect', 'reviewer', 'oneshot']) {
    if (raw.includes(`"${agent}"`)) ok(`agent ${agent} defined`);
    else bad(`agent ${agent} missing from deployed config`);
  }

  // Denying tools to make an agent read-only causes the run to hang. Verified 2026-08-22.
  if (/"(read|glob|grep|list|bash|edit)"\s*:\s*"deny"/.test(raw)) {
    warn('a tool permission is set to "deny" — this hangs runs; cap "steps" instead');
  }
}

// 3. Instruction isolation. opencode ingests ~/.claude/CLAUDE.md, so orchestration
//    protocol living there is read by the delegate and acted on.
const claudeMd = path.join(HOME, '.claude', 'CLAUDE.md');
if (!existsSync(claudeMd)) {
  warn('~/.claude/CLAUDE.md not present');
} else {
  const raw = readFileSync(claudeMd, 'utf8');
  if (/rotation\.json|opencode-rotation/i.test(raw)) {
    bad('~/.claude/CLAUDE.md references a rotation state file — the delegate reads this '
      + 'file and will try to follow it, reaching outside its working directory');
  } else ok('no rotation protocol leaking into the delegate-visible instruction file');

  if (/ignore the "Orchestration"|If you are not Claude Code/i.test(raw)) {
    ok('instruction file carries a delegate-facing isolation guard');
  } else {
    warn('~/.claude/CLAUDE.md has no isolation guard for non-Claude readers');
  }
}

// 4. Skills.
for (const skill of ['delegate', 'classify', 'verify']) {
  if (existsSync(path.join(HOME, '.claude', 'skills', skill, 'SKILL.md'))) ok(`skill ${skill} installed`);
  else warn(`skill ${skill} not installed`);
}

// 5. Registry sanity — every rotation model must exist in the live catalog.
const registry = JSON.parse(readFileSync(path.join(REPO, 'config', 'tiers.json'), 'utf8'));
let catalog = null;
try {
  catalog = execFileSync(OPENCODE, ['models'], { encoding: 'utf8', timeout: 60000 });
} catch { warn('could not list models (skipping catalog check)'); }

if (catalog) {
  const known = new Set(catalog.split('\n').map((l) => l.trim()).filter(Boolean));
  const missing = [];
  const check = (m) => { if (!known.has(`${registry.provider}/${m}`)) missing.push(m); };
  for (const t of Object.values(registry.tiers)) {
    t.rotation.forEach((r) => check(r.model));
    (t.unverified || []).forEach(check);
  }
  for (const r of Object.values(registry.roles)) r.rotation.forEach((x) => check(x.model));
  if (missing.length) bad(`models in registry but not in catalog: ${missing.join(', ')}`);
  else ok('every registry model exists in the live catalog');
}

// 6. Warm server.
const serverFile = path.join(STATE_DIR, 'server.json');
if (existsSync(serverFile)) {
  try {
    const st = JSON.parse(readFileSync(serverFile, 'utf8'));
    let running = false;
    try {
      running = execFileSync('tasklist', ['/FI', `PID eq ${st.pid}`], { encoding: 'utf8' })
        .includes(String(st.pid));
    } catch { /* tasklist unavailable */ }
    if (running) ok(`warm server running on ${st.url} (pid ${st.pid})`);
    else warn(`stale server state file — recorded pid ${st.pid} is not running; run: npm run serve:start`);
  } catch { warn('server state file is unreadable'); }
} else {
  warn('no warm server — dispatches pay process boot each call (npm run serve:start)');
}

// 7. Orphaned delegate processes racing the working directory.
try {
  const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq opencode.exe'], { encoding: 'utf8' });
  const count = (out.match(/opencode\.exe/g) || []).length;
  if (count > 1) warn(`${count} opencode processes running — check for orphans from timed-out runs`);
  else ok('no orphaned delegate processes');
} catch { /* not on Windows, or tasklist unavailable */ }

console.log(`\n  ${failures} failure(s), ${warnings} warning(s)\n`);
process.exit(failures ? 1 : 0);
