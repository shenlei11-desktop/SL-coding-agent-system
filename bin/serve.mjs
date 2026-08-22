#!/usr/bin/env node
/**
 * serve.mjs — manage a warm opencode server so dispatches skip process boot.
 *
 * Cold start was measured at >2 minutes on first invocation; warm calls are ~7s of
 * fixed overhead. Keeping one server alive for a working session removes that boot
 * from every dispatch. delegate.mjs auto-attaches when the state file below exists.
 *
 *   node bin/serve.mjs start|stop|status
 */

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const OPENCODE = process.env.OPENCODE_BIN
  || 'C:\\Users\\USER\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe';

const STATE_DIR = process.env.AGENT_STATE_DIR || path.join(homedir(), '.agent-system', 'state');
const SERVER_FILE = path.join(STATE_DIR, 'server.json');
const LOG_FILE = path.join(STATE_DIR, 'server.log');
const PORT = Number(process.env.AGENT_SERVE_PORT || 4096);

const cmd = process.argv[2] || 'status';

function readState() {
  try { return JSON.parse(readFileSync(SERVER_FILE, 'utf8')); } catch { return null; }
}

function alive(pid) {
  if (!pid) return false;
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`], { encoding: 'utf8' });
      return out.includes(String(pid));
    }
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

function stop() {
  const st = readState();
  if (!st) { console.log('no server recorded'); return; }
  if (alive(st.pid)) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/F', '/T', '/PID', String(st.pid)], { stdio: 'ignore' });
      } else {
        process.kill(-st.pid, 'SIGTERM');
      }
      console.log(`stopped pid ${st.pid}`);
    } catch (e) { console.log(`could not stop pid ${st.pid}: ${e.message}`); }
  } else {
    console.log(`pid ${st.pid} was not running (stale state file)`);
  }
  try { unlinkSync(SERVER_FILE); } catch { /* already gone */ }
}

function status() {
  const st = readState();
  if (!st) { console.log(JSON.stringify({ running: false })); return; }
  console.log(JSON.stringify({ running: alive(st.pid), ...st }));
}

function start() {
  const st = readState();
  if (st && alive(st.pid)) {
    console.log(JSON.stringify({ running: true, reused: true, ...st }));
    return;
  }

  mkdirSync(STATE_DIR, { recursive: true });
  const out = openSync(LOG_FILE, 'a');

  // Detached, with stdio to a file: the server must outlive this process.
  const child = spawn(OPENCODE, ['serve', '--port', String(PORT)], {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
  });
  child.unref();

  const state = { pid: child.pid, port: PORT, url: `http://127.0.0.1:${PORT}`, started: new Date().toISOString() };
  writeFileSync(SERVER_FILE, JSON.stringify(state, null, 2) + '\n');
  console.log(JSON.stringify({ running: true, reused: false, ...state }));
  console.log(`log: ${LOG_FILE}`);
}

if (cmd === 'start') start();
else if (cmd === 'stop') stop();
else if (cmd === 'status') status();
else { console.error('usage: serve.mjs start|stop|status'); process.exit(1); }
