#!/usr/bin/env node
/**
 * run-tests.mjs — portable `npm test`.
 *
 * `node --test "tests/**\/*.test.mjs"` needs Node 21+ to expand the glob argument
 * (fails on Node 20 with "Could not find ..."); a bare `node --test tests/` has
 * behaved inconsistently across the Node versions this project runs on across
 * devices. Collecting the files in JS and passing them explicitly to `node
 * --test` works the same on every Node >= 18 and in any shell.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const TESTS_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'tests');

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(p));
    else if (entry.name.endsWith('.test.mjs')) out.push(p);
  }
  return out;
}

const files = collect(TESTS_DIR).sort();
if (!files.length) {
  console.error('run-tests: no *.test.mjs files under tests/');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
