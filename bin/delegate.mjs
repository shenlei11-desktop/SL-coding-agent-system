#!/usr/bin/env node
/**
 * delegate.mjs — the orchestrator's single entry point for dispatching work to opencode.
 *
 * Replaces the old inline read-modify-write shell dance. Owns tier routing, model
 * rotation, prompt composition, invocation, process-tree lifetime, scope enforcement,
 * and cost logging.
 *
 * Design constraints this file exists to satisfy:
 *
 *  1. TOKEN EFFICIENCY. The orchestrator's context is the metered resource. The full
 *     NDJSON event stream goes to a log file on disk; stdout gets one compact JSON
 *     object (~60 tokens). The orchestrator never reads the stream.
 *
 *  2. LATENCY. Three levers, in order of payoff:
 *       - context pre-seeding (--seed): naming files up front removes the delegate's
 *         glob/grep exploration steps, and every removed step is a full model round-trip;
 *       - session reuse (--session): related tasks skip rebuilding repo context;
 *       - warm server (--attach, via `npm run serve:start`): removes process boot.
 *
 *  3. INSTRUCTION ISOLATION. This process resolves the model and passes -m itself, so
 *     the delegate never needs to know rotation state exists. Verified 2026-08-22:
 *     opencode ingests ~/.claude/CLAUDE.md, so anything written there reaches the
 *     delegate. Rotation state deliberately lives under ~/.agent-system/ instead.
 *
 *  4. SCOPE ENFORCEMENT. Declared --scope globs are diffed against git's actual
 *     porcelain output after the run. Strays are reverted by default (--keep-strays
 *     to opt out); untracked strays are reported, never deleted. This catches the
 *     class of bug where a run silently edits unrelated notebook metadata.
 *
 *  5. CROSS-REPO STANDARDISATION. Routing that should be the same every time a repo
 *     is targeted lives in that repo's .agent-system.json (tier, model, scope,
 *     baseline anti-patterns, ...). CLI flags override it; --no-config ignores it.
 *     Two dispatches whose scopes overlap in the same working directory are refused
 *     rather than allowed to race the tree (--no-overlap-check to override).
 */

import { spawn, execFileSync } from 'node:child_process';
import {
  createWriteStream, existsSync, mkdirSync, readFileSync,
  writeFileSync, renameSync, appendFileSync, realpathSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { resolveOpencodeBin } from './lib/resolve-opencode.mjs';
import {
  loadRepoConfig, resolveOptions, mergeAnti, scopesOverlap, globToRegExp, REPO_CONFIG_NAME,
} from './lib/dispatch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

// Spawn the native binary, not the .cmd shim. Two reasons: Node >=20 refuses to
// spawn .cmd without shell:true (and shell:true would mangle a multi-line prompt
// argument), and it drops a cmd.exe process layer from every call.
const OPENCODE = resolveOpencodeBin();

// Deliberately NOT under ~/.claude — opencode reads instruction files from there.
const STATE_DIR = process.env.AGENT_STATE_DIR || path.join(homedir(), '.agent-system', 'state');
const ROTATION_FILE = path.join(STATE_DIR, 'rotation.json');
const SERVER_FILE = path.join(STATE_DIR, 'server.json');
const LEDGER_FILE = path.join(STATE_DIR, 'ledger.jsonl');
const ACTIVE_FILE = path.join(STATE_DIR, 'active.json');

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

function fail(msg, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error: msg, ...extra }) + '\n');
  process.exit(1);
}

if (args.help || (!args.task && !args['task-file'])) {
  process.stderr.write(`
delegate.mjs — dispatch a scoped task to the opencode delegate

Required (one of):
  --task "<text>"          the task description
  --task-file <path>       read the task from a file

Routing:
  --tier 1|2|3             capability tier (default: 2)
  --role reviewer|oneshot  use a role agent instead of a tier
  --model <id>             pin an explicit model, bypassing rotation
  --include-unverified     allow models with no benchmark grounding into rotation

Scope & context:
  --scope "a.py,b/**.ts"   files the run is ALLOWED to change (comma-separated globs)
  --seed "x.py,y.py"       files to attach up front (removes exploration round-trips)
  --template <name>        compose the prompt from templates/<name>.md
  --anti "<text>"          anti-patterns; stated prohibitions, one per line
                           (repo baseline from .agent-system.json is prepended)

Scope enforcement:
  --keep-strays            do NOT auto-revert files changed outside --scope
                           (default: tracked strays are reverted, untracked reported)
  --no-overlap-check       allow a dispatch whose scope overlaps one already running
                           in the same working directory (default: refuse it)

Execution:
  --dir <path>             working directory (default: cwd)
  --session <id>           continue an existing session (skips repo re-exploration)
  --timeout <seconds>      default 900
  --allow-main             permit running while on the main branch
  --no-config              ignore <dir>/${REPO_CONFIG_NAME}
  --dry-run                print the resolved command and exit

Per-repo defaults: <dir>/${REPO_CONFIG_NAME} may set tier, model, template, timeout,
scope, seed, anti, includeUnverified, keepStrays. CLI flags win; --anti concatenates.

Output: one compact JSON object on stdout. Full event stream goes to the log file.
`);
  process.exit(args.help ? 0 : 1);
}

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

const cwd = path.resolve(args.dir || process.cwd());

// Canonical form for comparing working directories across invocations that may
// pass --dir differently (relative vs absolute, 8.3 short name, slash direction).
function canonDir(p) {
  try { return realpathSync.native(path.resolve(p)); }
  catch { return path.resolve(p); }
}
const cwdKey = canonDir(cwd);

function git(cmdArgs, opts = {}) {
  return execFileSync('git', cmdArgs, { cwd, encoding: 'utf8', ...opts }).trim();
}

function gitSafe(cmdArgs) {
  try { return git(cmdArgs); } catch { return null; }
}

const insideRepo = gitSafe(['rev-parse', '--is-inside-work-tree']) === 'true';
if (!insideRepo) fail('not inside a git repository', { cwd });

const branch = gitSafe(['rev-parse', '--abbrev-ref', 'HEAD']);
if (!args['allow-main'] && (branch === 'main' || branch === 'master')) {
  fail(
    `refusing to run on '${branch}'. Create a task branch first (git checkout -b <name>), ` +
    `or pass --allow-main to override.`,
    { branch },
  );
}

// ---------------------------------------------------------------------------
// per-repo config + option precedence
// ---------------------------------------------------------------------------

const repoCfg = args['no-config'] ? { path: null, config: {} } : loadRepoConfig(cwd);
if (repoCfg.error) {
  process.stderr.write(`warning: ${REPO_CONFIG_NAME} present but unparseable, ignoring it — ${repoCfg.error}\n`);
}
const opt = resolveOptions(args, repoCfg.config);
const antiList = mergeAnti(args.anti === true ? null : args.anti, repoCfg.config.anti);

const revertStrays = !opt.keepStrays;
const timeoutSec = Number(opt.timeout || 900);

// ---------------------------------------------------------------------------
// scope parsing — one source of truth, used by the overlap guard, the prompt,
// and the post-run enforcement
// ---------------------------------------------------------------------------

const scopeList = (opt.scope ? String(opt.scope).split(',') : [])
  .map((s) => s.trim()).filter(Boolean);
const scopeMatchers = scopeList.map(globToRegExp);
const inScope = (f) => scopeMatchers.some((re) => re.test(f.replace(/\\/g, '/')));

// Snapshot the pre-run dirty set so the scope check attributes only NEW changes.
//
// Note: porcelain status is column-significant — ' M path' has a leading space that
// carries meaning. It must NOT be trimmed before slicing, or the first entry loses a
// character off its filename.
function porcelain() {
  let raw;
  try {
    raw = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  } catch { return []; }
  return raw.split('\n').filter(Boolean).map((l) => {
    let p = l.slice(3);
    // Renames and copies report "old -> new"; the new path is what changed.
    const arrow = p.indexOf(' -> ');
    if (arrow !== -1) p = p.slice(arrow + 4);
    return p.trim().replace(/^"|"$/g, '');
  });
}
const dirtyBefore = new Set(porcelain());

// A file already dirty at dispatch is invisible to a set-difference of porcelain
// output — the delegate can rewrite it wholesale and `changed` stays empty, which
// then reads as "the run did nothing". Hash the in-scope dirty files now so the
// result can report what was actually touched. Verified against the ledger: this
// was the cause of ~half of "ok, 0 files" rows.
function workingHash(rel) {
  try { return execFileSync('git', ['hash-object', '--', rel], { cwd, encoding: 'utf8' }).trim(); }
  catch { return null; }
}
const preDirtyInScope = [...dirtyBefore].filter(inScope);
const preHash = {};
for (const f of preDirtyInScope) preHash[f] = workingHash(f);

// ---------------------------------------------------------------------------
// concurrency: refuse an overlapping scope in the same working directory
// ---------------------------------------------------------------------------

function readActive() {
  try { return JSON.parse(readFileSync(ACTIVE_FILE, 'utf8')); } catch { return []; }
}
function writeActive(list) {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${ACTIVE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n');
  renameSync(tmp, ACTIVE_FILE);
}
function pruneActive(list) {
  const now = Date.now();
  return list.filter((e) => {
    if (!e || !e.pid || e.pid === process.pid) return false;
    const started = Date.parse(e.started || 0) || 0;
    if (now - started > (Number(e.timeoutSec || 900) * 1000 + 60000)) return false;
    try { process.kill(e.pid, 0); return true; } catch { return false; }
  });
}

if (!args['no-overlap-check'] && !args['dry-run'] && scopeList.length) {
  const clash = pruneActive(readActive())
    .find((e) => canonDir(e.dir || '') === cwdKey && scopesOverlap(e.scope || [], scopeList));
  if (clash) {
    fail('a dispatch with an overlapping scope is already active in this working directory', {
      holder: { pid: clash.pid, scope: clash.scope, started: clash.started },
      yours: scopeList,
      hint: 'let it finish, make the scopes disjoint, or pass --no-overlap-check',
    });
  }
}

// ---------------------------------------------------------------------------
// tier / model resolution + rotation
// ---------------------------------------------------------------------------

const registry = JSON.parse(readFileSync(path.join(REPO, 'config', 'tiers.json'), 'utf8'));

function readRotation() {
  try { return JSON.parse(readFileSync(ROTATION_FILE, 'utf8')); } catch { return {}; }
}

function writeRotation(state) {
  // Write then rename, so a crash mid-write cannot leave corrupt state behind.
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${ROTATION_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, ROTATION_FILE);
}

function resolveTarget() {
  if (args.role) {
    const role = registry.roles[args.role];
    if (!role) fail(`unknown role '${args.role}'`, { known: Object.keys(registry.roles) });
    return { key: `role:${args.role}`, agent: role.agent, pool: role.rotation, unverified: [] };
  }
  const tier = String(opt.tier || 2);
  const t = registry.tiers[tier];
  if (!t) fail(`unknown tier '${tier}'`, { known: Object.keys(registry.tiers) });
  return { key: `tier${tier}`, agent: t.agent, pool: t.rotation, unverified: t.unverified || [] };
}

const target = resolveTarget();

let model;
let rotationIndex = null;
if (opt.model) {
  model = String(opt.model).replace(/^opencode-go\//, '');
} else {
  let candidates = target.pool.map((m) => m.model);
  if (opt.includeUnverified) candidates = candidates.concat(target.unverified);
  if (!candidates.length) fail(`no models available for ${target.key}`);

  const state = readRotation();
  const idx = Number.isInteger(state[target.key]) ? state[target.key] : 0;
  rotationIndex = idx % candidates.length;
  model = candidates[rotationIndex];

  // A reviewer must not share the implementer's model — a fresh prior is the point.
  if (args.role === 'reviewer' && args['not-model']) {
    const avoid = String(args['not-model']).replace(/^opencode-go\//, '');
    if (model === avoid && candidates.length > 1) {
      rotationIndex = (rotationIndex + 1) % candidates.length;
      model = candidates[rotationIndex];
    }
  }

  state[target.key] = (idx + 1) % candidates.length;
  writeRotation(state);
}

const qualifiedModel = `${registry.provider}/${model}`;

// ---------------------------------------------------------------------------
// prompt composition
// ---------------------------------------------------------------------------

let taskText = args['task-file']
  ? readFileSync(path.resolve(args['task-file']), 'utf8')
  : String(args.task);

function composePrompt() {
  let body;
  if (opt.template) {
    const tplPath = path.join(REPO, 'templates', `${opt.template}.md`);
    if (!existsSync(tplPath)) fail(`template not found: ${opt.template}`, { tplPath });
    body = readFileSync(tplPath, 'utf8');
  } else {
    body = '{{TASK}}\n\n{{SCOPE}}\n\n{{ANTI}}';
  }

  const scopeBlock = scopeList.length
    ? `## Files you may change\n\nYou may create or modify ONLY these paths:\n` +
      scopeList.map((s) => `- \`${s}\``).join('\n') +
      `\n\nChanging any other file is a failure of this task, including formatting-only ` +
      `edits and metadata. If the task cannot be done within these paths, stop and say so.`
    : '';

  const antiBlock = antiList.length
    ? `## Anti-patterns — these are prohibited\n\n` +
      antiList.map((l) => `- ${l}`).join('\n') +
      `\n\nThese are not stylistic preferences. Producing any of them means the task failed.`
    : '';

  const seedList = (opt.seed ? String(opt.seed).split(',') : [])
    .map((s) => s.trim()).filter(Boolean);
  const seedBlock = seedList.length
    ? `## Read these first\n\n` + seedList.map((s) => `- \`${s}\``).join('\n') +
      `\n\nThese are the relevant files. Read them before writing anything, and follow the ` +
      `patterns they establish. Do not search the repository for alternatives.`
    : '';

  return body
    .replace(/\{\{TASK\}\}/g, taskText)
    .replace(/\{\{SCOPE\}\}/g, scopeBlock)
    .replace(/\{\{ANTI\}\}/g, antiBlock)
    .replace(/\{\{SEED\}\}/g, seedBlock)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const prompt = composePrompt();

// ---------------------------------------------------------------------------
// build argv
// ---------------------------------------------------------------------------

const runArgs = ['run', prompt, '--dir', cwd, '--agent', target.agent, '-m', qualifiedModel, '--format', 'json'];

if (args.session) runArgs.push('--session', String(args.session));

// Attach to a warm server if one is running — removes process boot from the critical path.
let attached = false;
if (!args['no-attach'] && existsSync(SERVER_FILE)) {
  try {
    const srv = JSON.parse(readFileSync(SERVER_FILE, 'utf8'));
    if (srv.url) { runArgs.push('--attach', srv.url); attached = true; }
  } catch { /* stale server file — fall through to a cold run */ }
}

// Seed files as real attachments as well as naming them in the prompt.
//
// MUST be absolute. Verified in practice: when --attach hits a warm server, -f is
// resolved against the SERVER's launch directory, not this process's --dir. A relative
// path silently fails ("File not found") whenever the server was started from a
// different repo than the one being targeted — which is the normal case, since one
// warm server is meant to be reused across projects.
for (const f of (opt.seed ? String(opt.seed).split(',') : [])) {
  const t = f.trim();
  if (t) runArgs.push('-f', path.resolve(cwd, t));
}

if (args['dry-run']) {
  process.stdout.write(JSON.stringify({
    ok: true, dryRun: true, agent: target.agent, model: qualifiedModel,
    rotationIndex, attached, promptChars: prompt.length,
    repo_config: repoCfg.path ? path.relative(cwd, repoCfg.path).replace(/\\/g, '/') : null,
    resolved: { tier: opt.tier ?? null, scope: scopeList, seed: opt.seed || null, template: opt.template || null, revertStrays, timeoutSec },
    anti: antiList,
    argv: [OPENCODE, ...runArgs.map((a) => (a === prompt ? '<prompt>' : a))],
  }, null, 2) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

// Logs live outside the working tree. Writing them into the repo made every run
// dirty its own working directory, which then tripped this dispatcher's own scope
// guard and would have required a .gitignore entry in every project.
mkdirSync(STATE_DIR, { recursive: true });
const logDir = path.join(STATE_DIR, 'logs', path.basename(cwd));
mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = path.join(logDir, `${stamp}-${target.key}-${model}.ndjson`);
const logStream = createWriteStream(logPath);

// Register in the active set so a concurrent dispatch can see our scope. Best
// effort — a lost write just means the overlap guard misses this run.
const activeEntry = {
  pid: process.pid, dir: cwdKey, scope: scopeList, tier: opt.tier ?? null,
  started: new Date().toISOString(), timeoutSec,
};
try { writeActive([...pruneActive(readActive()), activeEntry]); } catch { /* non-fatal */ }
function deregister() {
  try { writeActive(pruneActive(readActive())); } catch { /* non-fatal */ }
}

const started = Date.now();

const child = spawn(OPENCODE, runArgs, {
  cwd,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

// Windows does not kill a child's descendants when the parent dies. Timed-out runs
// have previously left orphaned processes still writing to the working directory,
// which then race a subsequent run. taskkill /T is the reliable tree kill.
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch { /* already gone */ }
}, timeoutSec * 1000);

const summary = { sessionID: null, cost: 0, steps: 0, toolCalls: 0, errors: [], text: [] };

const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
rl.on('line', (line) => {
  logStream.write(line + '\n');
  let e;
  try { e = JSON.parse(line); } catch { return; }
  if (e.sessionID && !summary.sessionID) summary.sessionID = e.sessionID;
  const type = e.type;
  if (type === 'step_finish' || type === 'step-finish') {
    summary.steps++;
    if (typeof e.part?.cost === 'number') summary.cost += e.part.cost;
  } else if (type === 'tool') {
    summary.toolCalls++;
  } else if (type === 'text' && e.part?.text) {
    summary.text.push(e.part.text);
  } else if (type === 'error' || e.part?.type === 'error') {
    summary.errors.push(String(e.part?.error || e.error || 'unknown').slice(0, 300));
  }
});

let stderrBuf = '';
child.stderr.on('data', (d) => { stderrBuf += d.toString(); logStream.write(d); });

child.on('close', (code) => {
  clearTimeout(timer);
  logStream.end();
  finish(code);
});

// ---------------------------------------------------------------------------
// scope enforcement + result
// ---------------------------------------------------------------------------

function finish(code) {
  deregister();

  const wallSec = +((Date.now() - started) / 1000).toFixed(1);

  const dirtyAfter = porcelain();
  const changed = dirtyAfter.filter((f) => !dirtyBefore.has(f));

  // Everything the run actually edited inside --scope, including files that were
  // already dirty when it started (those never show up in `changed`).
  const touchedExtra = preDirtyInScope.filter((f) => {
    const after = workingHash(f);
    return after && preHash[f] && after !== preHash[f];
  });
  const touched = [...new Set([...changed.filter(inScope), ...touchedExtra])];

  const outOfScope = scopeList.length ? changed.filter((f) => !inScope(f)) : [];

  const reverted = [];
  const straysKept = [];
  for (const f of outOfScope) {
    // Only revert tracked files. An untracked stray is reported, never deleted —
    // deleting files is not something this process is permitted to do.
    const tracked = gitSafe(['ls-files', '--error-unmatch', f]) !== null;
    if (revertStrays && tracked && gitSafe(['checkout', '--', f]) !== null) reverted.push(f);
    else straysKept.push(f);
  }

  const ok = code === 0 && !timedOut && summary.errors.length === 0 && straysKept.length === 0;

  const result = {
    ok,
    agent: target.agent,
    model: qualifiedModel,
    branch,
    session: summary.sessionID,
    cost: +summary.cost.toFixed(5),
    steps: summary.steps,
    wall_s: wallSec,
    attached,
    changed,
    touched,
    out_of_scope: outOfScope,
    log: logPath.replace(/\\/g, '/'),
  };
  if (repoCfg.path) result.repo_config = path.relative(cwd, repoCfg.path).replace(/\\/g, '/');
  if (reverted.length) result.reverted = reverted;
  if (straysKept.length) result.strays_kept = straysKept;
  if (timedOut) result.error = `timed out after ${timeoutSec}s (process tree killed)`;
  else if (code !== 0) result.error = `opencode exited ${code}`;
  if (summary.errors.length) result.errors = summary.errors.slice(0, 3);
  if (!summary.steps && stderrBuf.trim()) result.stderr = stderrBuf.trim().slice(0, 300);

  // The delegate's closing message is often the only place it reports refusing to
  // expand scope. Keep the tail, not the whole transcript.
  const tail = summary.text.join('\n').trim();
  if (tail) result.reply = tail.slice(-600);

  try {
    appendFileSync(LEDGER_FILE, JSON.stringify({
      ts: new Date().toISOString(), repo: path.basename(cwd), ...result, reply: undefined,
    }) + '\n');
  } catch { /* ledger is best-effort; never fail a run over it */ }

  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(ok ? 0 : 1);
}
