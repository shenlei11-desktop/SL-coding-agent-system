/**
 * resolve-opencode.mjs — find the opencode binary without hardcoding a username.
 *
 * The original default was a literal path under this machine's Windows profile
 * (C:\Users\USER\...). That breaks the instant this repo runs under a different
 * account — including a second Windows device with the same opencode-go subscription
 * but a different Windows username. Resolve it from `npm root -g` instead, so the
 * only thing that ever needs to differ per-machine is OPENCODE_BIN itself, and only
 * when npm's global install location was customised.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

let cached;

export function resolveOpencodeBin() {
  if (cached) return cached;
  if (process.env.OPENCODE_BIN) return (cached = process.env.OPENCODE_BIN);

  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim();
    const exe = path.join(globalRoot, 'opencode-ai', 'bin',
      process.platform === 'win32' ? 'opencode.exe' : 'opencode');
    if (existsSync(exe)) return (cached = exe);
  } catch { /* npm not on PATH, or the package isn't installed globally — fall through */ }

  // Last resort: the per-user npm global location on Windows, or the generic npm shim
  // name elsewhere. Avoid a hardcoded USER placeholder, which breaks on any other account.
  const fallback = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'),
      'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
    : 'opencode';
  return (cached = fallback);
}
