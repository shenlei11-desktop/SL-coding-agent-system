#!/usr/bin/env node
/**
 * verify.mjs — the correctness gate as a mechanism, not a checklist.
 *
 * Runs, in order, stopping at the first hard failure:
 *   1. scope        — nothing changed outside --scope (or the repo's .agent-system.json)
 *   2. test-tamper  — the diff did not get to green by weakening the tests   [advisory]
 *   3. typecheck    — the repo's own typecheck command, if it has one
 *   4. lint         — the repo's own lint command, if it has one
 *   5. tests        — the repo's own test command; this is the real gate
 *
 * Emits one compact JSON object. It never writes to the tree, commits, or merges —
 * landing the change stays with the caller (see the `verify` skill). Read-only.
 *
 *   node scripts/verify.mjs --dir <repo> [--scope "globs"] [--against <ref>]
 *                           [--strict-tests] [--allow-no-tests]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadRepoConfig, resolveOptions, globToRegExp } from '../bin/lib/dispatch.mjs';
import { scanTestTamper } from '../bin/lib/verify-checks.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(obj.ok ? 0 : 1); }

if (args.help) {
  process.stderr.write('usage: verify.mjs --dir <repo> [--scope "globs"] [--against <ref>] '
    + '[--strict-tests] [--allow-no-tests]\n');
  process.exit(0);
}

const dir = path.resolve(args.dir || process.cwd());
if (!existsSync(dir)) emit({ ok: false, error: `no such directory: ${dir}` });

function git(a) {
  try { return execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim(); }
  catch { return null; }
}
// Untrimmed — porcelain status is column-significant: a leading ' ' in ' M path'
// carries meaning, and trimming it shears a character off the first filename.
function gitRaw(a) {
  try { return execFileSync('git', a, { cwd: dir, encoding: 'utf8' }); }
  catch { return null; }
}
if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') {
  emit({ ok: false, error: 'not inside a git repository', dir });
}
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const against = args.against ? String(args.against) : 'HEAD';

// --scope from the CLI, else the repo's own .agent-system.json
const repoCfg = loadRepoConfig(dir);
const opt = resolveOptions(args, repoCfg.config);
const scopeList = (opt.scope ? String(opt.scope).split(',') : [])
  .map((s) => s.trim()).filter(Boolean);
const scopeMatchers = scopeList.map(globToRegExp);

// ---------------------------------------------------------------------------

function run(cmd) {
  const r = spawnSync(cmd, { cwd: dir, shell: true, encoding: 'utf8', timeout: 600000 });
  return { code: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}
function toolPresent(cmd) {
  const r = spawnSync(cmd, { cwd: dir, shell: true, encoding: 'utf8', timeout: 30000 });
  return r.status === 0;
}
const pkg = (() => {
  try { return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')); }
  catch { return null; }
})();
const pyProject = existsSync(path.join(dir, 'pyproject.toml'))
  || existsSync(path.join(dir, 'setup.cfg')) || existsSync(path.join(dir, 'setup.py'));

const gates = [];
const hint = { scope: 'revert the stray, or widen --scope only if the task genuinely needs it',
  test_tamper: 'restore the test; if it is genuinely wrong, say so explicitly — do not quietly edit it',
  typecheck: 're-dispatch with the type error seeded; never loosen a type to pass',
  lint: 're-dispatch with the lint output seeded; never disable the rule',
  tests: 're-dispatch with the failing test seeded and its output in the task; do not weaken the test' };

let stopped = false;
function addGate(name, status, extra = {}) {
  gates.push({ name, status, ...extra });
  if (status === 'fail') stopped = true;
}

// 1. scope --------------------------------------------------------------------
{
  const changed = (gitRaw(['status', '--porcelain']) || '')
    .split('\n').filter(Boolean)
    .map((l) => { let p = l.slice(3); const i = p.indexOf(' -> '); if (i !== -1) p = p.slice(i + 4); return p.trim().replace(/^"|"$/g, ''); });
  if (!scopeList.length) {
    addGate('scope', 'skip', { reason: 'no --scope given and no .agent-system.json scope', changed: changed.length });
  } else {
    const strays = changed.filter((f) => !scopeMatchers.some((re) => re.test(f.replace(/\\/g, '/'))));
    addGate('scope', strays.length ? 'fail' : 'pass', strays.length ? { strays, next: hint.scope } : { files: changed.length });
  }
}

// 2. test-tamper (advisory) --------------------------------------------------
if (!stopped) {
  const diff = gitRaw(['diff', against]) || '';
  const { flags } = scanTestTamper(diff);
  if (!flags.length) addGate('test_tamper', 'pass');
  else if (args['strict-tests']) addGate('test_tamper', 'fail', { flags, next: hint.test_tamper });
  else addGate('test_tamper', 'warn', { flags, note: 'advisory — pass --strict-tests to make this fail the gate' });
}

// 3. typecheck --------------------------------------------------------------
if (!stopped) {
  if (pkg?.scripts?.typecheck) {
    const r = run('npm run typecheck');
    addGate('typecheck', r.code === 0 ? 'pass' : 'fail', r.code === 0 ? { cmd: 'npm run typecheck' } : { cmd: 'npm run typecheck', tail: r.out.slice(-3000), next: hint.typecheck });
  } else if (pyProject && toolPresent('mypy --version')) {
    const r = run('mypy .');
    addGate('typecheck', r.code === 0 ? 'pass' : 'fail', r.code === 0 ? { cmd: 'mypy .' } : { cmd: 'mypy .', tail: r.out.slice(-3000), next: hint.typecheck });
  } else {
    addGate('typecheck', 'skip', { reason: 'no typecheck script / mypy not available' });
  }
}

// 4. lint ------------------------------------------------------------------
if (!stopped) {
  if (pkg?.scripts?.lint) {
    const r = run('npm run lint');
    addGate('lint', r.code === 0 ? 'pass' : 'fail', r.code === 0 ? { cmd: 'npm run lint' } : { cmd: 'npm run lint', tail: r.out.slice(-3000), next: hint.lint });
  } else if (pyProject && toolPresent('ruff --version')) {
    const r = run('ruff check .');
    addGate('lint', r.code === 0 ? 'pass' : 'fail', r.code === 0 ? { cmd: 'ruff check .' } : { cmd: 'ruff check .', tail: r.out.slice(-3000), next: hint.lint });
  } else {
    addGate('lint', 'skip', { reason: 'no lint script / ruff not available' });
  }
}

// 5. tests — the gate ----------------------------------------------------------
if (!stopped) {
  let cmd = null;
  if (pkg?.scripts?.test) cmd = 'npm test';
  else if (pyProject && toolPresent('pytest --version')) cmd = 'pytest -q';
  if (!cmd) {
    addGate('tests', args['allow-no-tests'] ? 'skip' : 'fail',
      { reason: 'no test runner found', next: 'add a test that fails without the change, or pass --allow-no-tests to acknowledge there is no suite' });
  } else {
    const r = run(cmd);
    addGate('tests', r.code === 0 ? 'pass' : 'fail',
      r.code === 0 ? { cmd } : { cmd, exit: r.code, tail: r.out.slice(-3000), next: hint.tests });
  }
}

// ---------------------------------------------------------------------------

const failed = gates.filter((g) => g.status === 'fail').map((g) => g.name);
const warned = gates.filter((g) => g.status === 'warn').map((g) => g.name);
emit({
  ok: failed.length === 0,
  dir, branch, against,
  scope: scopeList.length ? scopeList : null,
  repo_config: repoCfg.path ? path.relative(dir, repoCfg.path).replace(/\\/g, '/') : null,
  gates,
  failed,
  warned,
  reminder: 'diff-review for silent partial completion and the optional second-model review are still yours to do — see the verify skill',
});
