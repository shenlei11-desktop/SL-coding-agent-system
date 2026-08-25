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
import path from 'node:path';

let cached;

export function resolveOpencodeBin() {
  if (cached) return cached;
  if (process.env.OPENCODE_BIN) return (cached = process.env.OPENCODE_BIN);

  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    const exe = path.join(globalRoot, 'opencode-ai', 'bin',
      process.platform === 'win32' ? 'opencode.exe' : 'opencode');
    if (existsSync(exe)) return (cached = exe);
  } catch { /* npm not on PATH, or the package isn't installed globally — fall through */ }

  // Last resort: this machine's known location, kept only so a broken `npm root -g`
  // doesn't leave every command with no default at all.
  const fallback = process.platform === 'win32'
    ? 'C:\\Users\\USER\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe'
    : 'opencode';
  return (cached = fallback);
}
