# Setting up on a second device

Same opencode-go subscription, a second Windows machine. What's shared and what's per-device.

## What's shared (the subscription)

opencode-go authentication is tied to the **account**, not the machine. Nothing about the
subscription needs copying over — you log in again on the new device and it's the same
account, same flat-rate usage.

## What's per-device (state, not config)

Two things live outside this repo and are **not** meant to sync between devices:

- **Rotation index** (`~/.agent-system/state/rotation.json`) — which model in each
  tier's pool goes next. Each device starts its own rotation independently; that's fine,
  since the point is just spreading usage across a tier's pool, not a global counter.
- **Cost ledger** (`~/.agent-system/state/ledger.jsonl`) — per-device run history. Don't
  merge these; `--by-model` stats are more useful kept separate per machine unless you
  specifically want a combined view later.

Don't try to sync `~/.agent-system/` between devices. Everything that should transfer
lives in this repo instead.

## Setup steps

**1. Get the repo onto the new device.**

This repo isn't pushed anywhere yet — push it to a private remote first, then clone on
the new device:
```bash
# on this device, one-time
git remote add origin <your-private-repo-url>
git push -u origin feat/agent-system

# on the new device
git clone <url> SL-coding-agent-system
cd SL-coding-agent-system
git checkout feat/agent-system
```

**2. Install prerequisites on the new device.**
```bash
node --version      # needs >=20
npm i -g opencode-ai
```

**3. Log into opencode-go on the new device.**
```bash
opencode auth login
```
Follow its prompt and select the `opencode-go` provider. This is the one manual step
that can't be scripted — credentials shouldn't live in a file that gets committed or
casually copied around.

**4. Deploy this repo's config.**
```bash
node scripts/install.mjs
```
Same as on this device — writes `~/.config/opencode/opencode.jsonc` and `~/.claude/`
(CLAUDE.md + skills), backing up anything it replaces.

**5. Verify.**
```bash
node scripts/doctor.mjs
```
Should come back 0 failures. If the binary check fails, `npm root -g` most likely
returned something unexpected on that machine — set `OPENCODE_BIN` explicitly as a
fallback (see below).

**6. Optional — start the warm server.**
```bash
node bin/serve.mjs start
```

## If the binary still isn't found

As of this fix, `bin/lib/resolve-opencode.mjs` finds the opencode binary via `npm root -g`
rather than a hardcoded path — so a different Windows username on the new device is no
longer a problem by itself. It only fails if `npm` isn't on PATH in the shell running
these scripts, or the global install location was customised. In that case:

```bash
setx OPENCODE_BIN "C:\path\to\opencode.exe"    # persists across sessions
```
or set it per-session before running a command. `where opencode` will show you the
`.cmd` shim's location if you need to derive the real `.exe` path manually — it's
`<npm-global>\node_modules\opencode-ai\bin\opencode.exe`.

## What NOT to copy between devices

- `~/.local/share/opencode/auth.json` — contains the raw API key. Re-authenticate
  instead (step 3). If you ever do need to move it, treat it like any other credential
  file — never through this repo, never through a plain copy to shared storage.
- `~/.agent-system/state/` — see above, per-device by design.
- `~/.local/share/opencode/opencode.db` — session history and snapshots are local to
  where the work happened; there's nothing to gain from merging it.
