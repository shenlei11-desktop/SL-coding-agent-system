# Orchestrator/Delegate Coding System — Context Brief

**Purpose of this document.** Self-contained context for an external model or reader with
zero knowledge of the originating conversation. It describes an existing two-tool agentic
coding system, what was empirically verified about it, what is being built next, and the
open research questions. If you are an external model being asked to advise: read §1–§5
for grounding, then answer §7.

**Status:** design phase. Nothing in §5 is built yet.
**Repo:** `SL-coding-agent-system` (currently empty apart from a README).
**Date of findings:** 2026-08-22. All measurements in §4 are first-hand from this machine.

---

## 1. What the system is

A two-process division of labour between two separate agentic coding tools:

- **Claude Code (the orchestrator).** Plans, scopes, routes, and verifies. Does *not*
  edit application source directly.
- **opencode (the delegate).** An external agentic CLI with its own tool loop
  (bash/read/edit/glob/grep). Receives a scoped task prompt, runs its own agent loop
  against a third-party model, and writes the actual code.

The orchestrator dispatches via subprocess, then verifies the result through
`git status` / `git diff` — deliberately *never* by reading the delegate's output stream
back into its own context.

### Why this shape

Two budgets that are easy to conflate:

| Budget | Metered? | What consumes it |
|---|---|---|
| Claude's context window | **Yes** — the real constraint | Prompt text written + verification diff read |
| opencode's token spend | No — flat-rate subscription | All file reading, reasoning, and code generation |

Measured: a well-scoped delegation costs the orchestrator roughly **600–1,500 tokens**
regardless of how much work the delegate performed. The same task done directly by the
orchestrator would spend its metered budget on every file read and every line generated.

**The saving is not dollars-vs-dollars** (the delegate's spend is already sunk in a flat
fee). The saving is that expensive reasoning happens in a process whose context is free.

Observed delegate-side costs for calibration: a one-paragraph README edit ≈ **$0.0028**
across 3 steps; a real code task (read 2 files, write a 140-line test) ≈ **$0.049** across
5 steps. A trivial no-tool prompt still costs ≈ **$0.008** because the system prompt alone
is ~8,270 input tokens.

---

## 2. Environment ground truth

- **OS:** Windows 11 Pro. Orchestrator drives both PowerShell and Git Bash.
- **opencode binary:** `C:\Users\USER\AppData\Roaming\npm\opencode.cmd`
  (installed via `npm i -g opencode-ai`). **Not on PATH** — must be invoked by full path.
  Invoking via `npx opencode-ai@latest` re-resolves the package over the network on every
  call and was measured as a real latency bottleneck. Do not use npx.
- **Config:** `C:\Users\USER\.config\opencode\opencode.jsonc`
  (schema: `https://opencode.ai/config.json`)
- **State/session DB:** `C:\Users\USER\.local\share\opencode\opencode.db` — SQLite, ~39 MB.
  Tables include `session`, `message`, `part`, `permission`. **Readable read-only while
  opencode runs**, and it is a far cheaper verification channel than parsing the CLI's
  JSON event stream.
- **Providers:** `opencode-go` authenticated (flat-rate subscription). `opencode` (Zen,
  pay-per-token) has **no entry in `auth.json`** — it is simply unauthenticated, not
  corrupted as previously assumed. Authenticating it unlocks 6 genuinely free models.

### Model catalog (verified present, 2026-08-22)

`opencode-go` exposes 22 models. Current tier table below; **all 19 listed models exist**.

| Tier | Intended use | Models |
|---|---|---|
| 1 — simple/docs | README, comments, copy, formatting, boilerplate | `deepseek-v4-flash`, `hy3`, `mimo-v2.5`, `glm-5.1`, `kimi-k2.6` |
| 2 — standard | Typical fixes, small features, 1–3 files, no architecture | `kimi-k2.7-code`, `deepseek-v4-pro`, `glm-5.2`, `glm-5.3`, `mimo-v2.5-pro`, `minimax-m2.7`, `qwen3.6-plus`, `qwen3.7-plus` |
| 3 — complex/critical | Multi-file refactors, security/financial logic, tier-2 failures | `grok-4.5`, `gpt-5.6-luna`, `kimi-k3`, `minimax-m3`, `qwen3.7-max`, `qwen3.8-max` |

Present in the catalog but **absent from the tier table**: `deepseek-v4-flash-vision-exp`,
`muse-spark-1.2-contributor`, `ox-alpha-free`.

Free models behind the unauthenticated `opencode` provider: `hy3-free`,
`mimo-v2.5-free`, `nemotron-3-ultra-free`, `nemotron-3.5-lightning-free`,
`x-preview-f-free`, `muse-spark-1.2-contributor-free`, plus `big-pickle`.

> **Important caveat.** Tier placement was inferred purely from model *naming* —
> generation numbers and `flash`/`plus`/`pro`/`max` suffixes treated as strength signals.
> It is not grounded in any benchmark. See research question R1.

---

## 3. Current operating rules

1. Orchestrator never edits application source; everything is delegated.
2. Scope prompts tightly — name exact files and lines, state what *not* to touch.
3. Rotate through every model in a tier rather than always using the first, so the
   subscription's per-model allowances are all exercised. Rotation index is tracked in
   `~/.claude/opencode-rotation.json` as `{"tier1":N,"tier2":N,"tier3":N}`,
   read-modify-written inline by the orchestrator before each call.
4. Verification loop: confirm clean tree → delegate → read `git diff` → if wrong or
   scope-crept, tighten the prompt or escalate one tier; never blindly re-run.
5. Never dump the raw `--format json` event stream into the orchestrator's context — it
   duplicates full file contents across several fields per tool call.
6. Never delegate `git push`, force operations, or deletions.

---

## 4. Verified findings

### 4.1 Confirmed true

**Scoped permissions are supported.** `permission.external_directory` accepts an *object
map* of pattern → `allow|ask|deny`, not only a bare string. The current global
`"external_directory": "allow"` — applied as a blunt workaround — can be narrowed.
Full permission key set: `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`,
`external_directory`, `todowrite`, `question`, `webfetch`, `websearch`, `lsp`,
`doom_loop`, `skill`.

**A denied permission need not abort the run.** Previously, a single denial hard-stopped
the entire run with no output. `experimental.continue_loop_on_deny: true` exists and
addresses this directly.

**A non-agentic single-shot mode is reachable.** `AgentConfig.steps` is documented as
*"maximum number of agentic iterations before forcing text-only response."* Combined with
permission-based tool denial, `steps: 1` should yield a true completion-style call with no
tool loop. *(Not yet empirically confirmed — see V3.)*

**Session reuse is fully supported.** `opencode serve` (headless server) plus
`run --attach <url> --session <id>`, with `--fork` and `-c/--continue` available.

**Rich configuration surface, largely unused.** Top-level config keys include: `agent`,
`command`, `permission`, `skills`, `instructions`, `experimental`, `tool_output`,
`subagent_depth`, `compaction`, `snapshot`, `small_model`, `default_agent`, `formatter`,
`lsp`, `mcp`, `plugin`, `shell`, `provider`.

- `AgentConfig` fields: `model`, `variant`, `temperature`, `top_p`, `prompt`, `disable`,
  `description`, `mode` (`subagent`/`primary`/`all`), `hidden`, `steps`, `permission`, `color`.
- `command` entries: `template` (required), `description`, `agent`, `model`, `variant`, `subtask`.
- Useful CLI flags never used: `--agent`, `--command`, `--variant` (reasoning effort),
  `--thinking`, `--fork`, `--attach`, `--dir`, `-f/--file`, `--title`, `--auto`.
- Useful subcommands never used: `serve`, `stats`, `export`, `session`, `agent`, `plugin`, `db`.

### 4.2 Previously believed, now disproven

**"The `-m` flag does not pin the model."** *False.* This was the single biggest premise in
doubt, because run banners repeatedly showed `build · gpt-5.6-luna` when other models were
requested. Reading the session DB directly resolves it: every message row records both the
requested and the actually-used model, and **they always match**. Sessions exist recording
`kimi-k2.7-code`, `grok-4.5`, `glm-5.2`, `deepseek-v4-flash` — each exactly as requested.
The `gpt-5.6-luna` sessions *requested* `gpt-5.6-luna`; it is the sticky default used when
`-m` is omitted or fails to resolve. **The tier system means what it claims.**

**"Any file-creating task takes well over 2 minutes."** *False as a general rule.* Measured
end-to-end wall time for a warm trivial run: **6.66 seconds**, exit 0. A cold first
invocation did exceed 2 minutes, but that is one-time initialisation, not per-call overhead.
Real tasks still scale with actual work performed, but the fixed cost is small once warm.
This matters because the belief drove defensive backgrounding and tier-downgrading to dodge
a cost that mostly does not exist.

### 4.3 Reframed: the rotation-file mystery

**Previously recorded as:** "opencode's own build agent reads and increments
`~/.claude/opencode-rotation.json` itself — a real live shared mechanism between the two
tools." Symptoms: the index advanced further than the orchestrator had set it; the delegate
reached outside its working directory unprompted even when told to stay in the repo; that
out-of-directory read hit the `external_directory` gate, which cannot prompt in
non-interactive mode, so it silently denied and killed the entire run.

**Almost certainly the real cause: instruction leakage.** opencode ingests `AGENTS.md` and
`CLAUDE.md` as instruction files. The orchestrator's rotation protocol is documented in a
`CLAUDE.md`. So the delegate read the *orchestration protocol* and began dutifully following
it — including "read the rotation file, pick the model, increment, write back."

One explanation covers all three symptoms: the unexplained index bumps, the "unprompted"
out-of-directory access, and the resulting hard-stop denials. The delegate was not
wandering; it was obeying instructions never intended for it.

**Consequence — instruction isolation becomes a first-class design principle.** The delegate
must never see the orchestration layer's instructions. Orchestrator rules and delegate rules
are currently the same file; they must be separated.

*(Stated as a strong hypothesis, not yet confirmed — see V1.)*

### 4.4 Still-unexplained behaviours

**Windows process orphaning.** Killing the parent shell via a tool-call timeout does **not**
kill the child process tree. Timed-out attempts have left orphaned `node.exe` processes still
running and writing to logs — risking two concurrent agent sessions racing on the same files.
Mitigation: check `tasklist` and `taskkill /F /PID <pid> /T` before relaunching.

**Delegates reinvent a wrong generic pattern when given a loose interface spec, and
escalating tier does not fix it.** Concrete case: asked via a detailed prose prompt (with
function signatures) to build a subprocess-based CLI wrapper mirroring an existing module's
interface. A tier-2 model (`kimi-k2.7-code`) and a tier-3 model (`grok-4.5`) *independently
produced the identical wrong artefact* — a generic OpenAI-compatible HTTP client hitting a
hypothetical REST endpoint already proven to return 401 — instead of the correct
subprocess + NDJSON-parsing pattern.

This is a **training-data-prior problem**, not a capability gap: a common pattern
out-competing a correct-but-rare one. A bigger model made the same mistake. The workaround
that actually worked was to stop asking for an implementation of a spec, and instead write
the exact correct code directly, delegating only transcription/placement. Directly informs
research question R2.

**Scope creep appears as unrelated file touches, not just wrong content.** One run silently
modified an unrelated notebook's kernel metadata (`display_name`, `language_info.version`) in
a different `.ipynb` entirely. Trivial in content, but out of scope and needing revert.
Always check *full* `git status`, never just the file expected to change.

---

## 5. What is being built

Goal: turn an ad-hoc, orally-transmitted convention into a version-controlled, reproducible,
production-grade system. Repo is source of truth; an idempotent installer deploys to
`~/.claude` and `~/.config/opencode`.

### Phase 0 — verify remaining assumptions — **COMPLETE, all three resolved**

- **V1. CONFIRMED — opencode ingests the global `~/.claude/CLAUDE.md`.** Asked the
  delegate directly whether its loaded instructions mentioned a rotation protocol; it
  answered yes and named `C:\Users\USER\.claude\CLAUDE.md` as the source. The
  instruction-leakage explanation in §4.3 is therefore a verified fact, not a hypothesis.
  Every opencode run on this machine had been ingesting the orchestrator's playbook.
- **V2. CONFIRMED — CLI `-m` overrides an agent's configured `model`.** A test agent
  configured with `glm-5.1`, invoked with `-m opencode-go/hy3`, recorded `hy3` for both
  the requested and used model. Tiers-as-agents with model rotation inside them is sound.
- **V3. CONFIRMED, with an important correction — `steps: 1` alone yields a tool-free
  single-shot** (zero tool events, pure text, exit 0, ~12s). **But denying tools via
  `permission` hangs the run.** The first attempt — `steps: 1` *plus*
  `permission: {read: deny, ...}` — produced zero bytes and had to be killed at 2 minutes.
  **Cap `steps`; never deny tools.** This also re-explains §4.4's "denial aborts the run":
  denial does not degrade, it stalls.

### Phase 1 — hardened opencode config
The central shift: **tiers become opencode *agents*, not bare model strings.** Today a tier
is only a `-m` value, so all behavioural contract lives in whatever prose the orchestrator
improvises that call. Instead, each tier gets a real agent definition owning its system
prompt, permission set, and step cap; rotation then swaps only the *model within* a tier.

Planned agents: `t1-scribe`, `t2-build`, `t3-architect`, `reviewer` (read-only, no edit
tools), `oneshot` (`steps: 1`, no tools). Plus scoped `external_directory` replacing the
global `allow`, `continue_loop_on_deny: true`, and `tool_output` truncation caps.

### Phase 2 — dispatcher CLI
One command replacing inline read-modify-write shell. Owns tier routing, rotation,
invocation, scope declaration, and a JSONL cost/session ledger. Critically: **the dispatcher
resolves the model and passes `-m`, so the delegate never needs to know rotation exists** —
removing the external-directory dependency entirely rather than permissioning around it.

### Phase 3 — command templates
opencode's `command` mechanism gives versioned, reusable task templates (`implement`, `fix`,
`test`, `docs`). This is the structural fix for the training-prior failure: rather than the
orchestrator free-writing prose each call, the template carries house patterns and explicit
anti-patterns, checked into git.

### Phase 4 — orchestrator skills + scope guard
- `classify` — the loose-spec-safe vs. precision-critical decision, made an explicit gate
  rather than something discovered after a wasted round-trip.
- `delegate`, `verify` — the dispatch and verification loops as invocable procedures.
- **Scope guard** — declare expected file globs up front; diff `git status --porcelain`
  against them post-run; flag or auto-revert strays. Catches the notebook-metadata class of
  bug automatically.

### Phase 5 — installer and documentation
Idempotent deploy with backup of anything it replaces.

---

## 6. Design tensions not yet resolved

1. **Where the precision-critical boundary sits.** Writing exact code directly defeats the
   token economics that justify the system; delegating loose specs produces wrong artefacts.
   The classify gate needs a decision rule sharper than intuition.
2. **Whether session reuse is worth its complexity** now that warm invocations are known to
   cost ~7s rather than ~2min. The remaining benefit is avoiding repeated repo exploration
   across related tasks, not raw latency.
3. **How much autonomy to grant.** Scope guard as a safety net enabling fire-and-forget, vs.
   diff review before anything lands.
4. **Verification depth.** `git diff` proves *what* changed, not that it is *correct*. Tests,
   typecheck, and lint gates are unspecified.

---

## 7. Research questions

> These are the questions being taken to external models/sources. Answer any you can, and
> please distinguish what you actually know from what you are inferring.

**R1 — Model tiering (highest value).**
Tier placement above is guessed from model names. What is actually known about the coding
capability of: `deepseek-v4-flash` / `-pro`, `hy3`, `mimo-v2.5` / `-pro`, `glm-5.1` / `5.2` /
`5.3`, `kimi-k2.6` / `k2.7-code` / `k3`, `minimax-m2.7` / `m3`, `qwen3.6-plus` /
`3.7-plus` / `3.7-max` / `3.8-max`, `grok-4.5`, `gpt-5.6-luna`? Any benchmark data
(SWE-bench, Aider polyglot, LiveCodeBench), context-window sizes, tool-calling reliability,
or known failure modes. Which are genuinely strong at *agentic* coding — multi-step tool use
and instruction-following — as opposed to single-shot generation? Corrections to the
three-tier split are more useful than confirmation.

**R2 — Defeating training-data priors.**
Two models at different capability tiers independently produced the *same* wrong
implementation (a generic HTTP client) instead of a correct-but-rare pattern (subprocess +
NDJSON parsing), despite a detailed prose spec with function signatures. Escalating model
tier did not help. What prompting techniques reliably steer a model off a dominant prior?
Specifically interested in: negative/anti-pattern examples, skeleton-first or
fill-in-the-blank scaffolding, one-shot examples of the rare correct pattern, forcing an
explicit plan before code, and whether structured output constraints help. Evidence or
practitioner reports preferred over intuition.

**R3 — Orchestrator→delegate handoff contracts.**
Is there prior art on the *format* of a task handoff between a planning agent and an
executing agent? Interested in what fields such a contract carries (scope globs, acceptance
criteria, anti-patterns, forbidden operations), and whether anyone has published a schema
worth adopting rather than inventing.

**R4 — opencode specifics.**
Real-world experience with: `command` template syntax and argument interpolation; agent
definition file format and precedence; the plugin API (can a plugin enforce a scope guard
*inside* the run rather than after?); `serve` + `--attach` reliability for session reuse;
and whether `--variant` reasoning-effort control is honoured across these providers.

**R5 — Verification beyond the diff.**
`git diff` shows what changed, not whether it is right. What lightweight gates give the best
correctness-signal per unit of orchestrator context? Candidates: run existing tests,
typecheck, lint, delegate a read-only review to a *second* model, property/smoke tests.
Which of these actually catch agent-authored bugs in practice?

**R6 — Windows process management.**
Reliable pattern for launching a long-running child process tree from an agent harness on
Windows such that timeout/cancellation kills the whole tree, avoiding orphaned processes
racing on the same working directory. Job objects, process groups, or a supervisor wrapper?

---

## 8. User profile needed

The system's shape depends on working preferences that cannot be inferred from the code.
These are open questions for the system's owner:

1. **Project types** — what is mostly being built? (Known so far: a `CTI-automation-mvp`
   security/automation project, and some Jupyter notebooks.)
2. **Stacks and languages** most often used.
3. **Tests** — written by hand, or expected from the system? Should a change be blocked
   until tests pass? Same question for linting and typechecking.
4. **Git discipline** — work directly on `main`, or branch per task? Should the system
   auto-commit each verified delegation, or leave staging to the user?
5. **Review appetite** — see and approve every diff before it lands, or fire-and-forget with
   the scope guard as the safety net? *This is the single biggest fork in the design.*
6. **Typical task size** handed off — one-line fixes, whole features, multi-file refactors?
7. **Biggest current pain point** — latency, babysitting, wrong output, token cost, or
   something else?
