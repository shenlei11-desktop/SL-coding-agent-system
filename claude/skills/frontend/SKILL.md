---
name: frontend
description: Frontend design and redesign for the three surfaces this system builds — portfolio / marketing sites, product apps, and internal tools / dashboards. Classifies the surface first, then applies the matching discipline; shared anti-slop rules underneath. Use before planning or dispatching any UI work. Triggers on "redesign my frontend", "build a landing page", "portfolio site", "app UI", "product screen", "dashboard", "internal tool", "make this look less generic / templated / AI-ish", "style this page".
---

# Frontend

> Covers three surfaces: **marketing / portfolio**, **product app**, **tool / dashboard**.
> Every rule is contextual. Read the brief, classify the surface, then pull only what fits.
> Nothing here fires automatically.

This system delegates implementation to opencode. This skill's job is to make the
**dispatch brief** good: classify the surface, set the direction, name the concrete rules
and anti-patterns, then hand `--task` / `--anti` / `--seed` to `delegate`. Write the code
directly only when it is small and precision-critical (Route C — see `classify`).

---

## 0. Classify the surface (do this first, one line)

Before any plan or code, state the read in one sentence:

> *"Reading this as: **&lt;surface&gt;** for **&lt;audience&gt;**, **&lt;preserve | evolve | overhaul&gt;**, leaning **&lt;aesthetic / design-system family&gt;**, on **&lt;the target repo's actual stack&gt;**."*

**The three surfaces:**

| Surface | What it is | Governing section |
|---|---|---|
| **Marketing / portfolio** | Landing pages, product marketing, personal or studio portfolios, about pages, launch pages | §2 |
| **Product app** | Signed-in product UI, multi-step flows, settings, CRUD screens, editors, consumer app screens | §3 |
| **Tool / dashboard** | Internal tools, admin panels, dashboards, data tables, monitoring, config UIs, CLIs-with-a-web-face | §4 |

**Redesign mode** (when the ask is "redesign X", not "build X"): first read what exists —
brand assets, palette, type, information architecture, component inventory. Preserve brand
identity, content, and URL structure unless told to overhaul. Change one layer at a time
(spacing → type → color → layout), not all at once.

**If the read is genuinely ambiguous** — portfolio vs app, preserve vs overhaul, which
design-system family — ask **exactly one** question. If you can infer it, don't ask;
declare the read and proceed.

---

## 1. Shared core (all three surfaces)

### 1.1 Stack — match the target repo
The stack is whatever the target repo already uses. Check `package.json` / the existing
files first. Vanilla HTML/CSS/JS with no build step is a legitimate and common answer here
(the usage dashboard in this repo is exactly that). Do **not** introduce React, Next, a
bundler, Tailwind, or a component library into a project that has none just to apply a
pattern. If the repo is already React/Next/Tailwind, use its conventions.

### 1.2 One theme, one accent, one radius
- **Theme lock.** One theme for the whole page — light, dark, or system. No section flips
  to an inverted mode mid-page. Support dark mode via `prefers-color-scheme` (and a toggle
  if either mode loses brand expression). Never pure `#000` / `#fff` — off-black, off-white.
- **Accent lock.** One accent colour, used identically everywhere. A warm-grey page does
  not get a blue CTA in section 7. Saturation < 80% unless the brand is genuinely loud.
- **Radius lock.** One corner-radius system (all-sharp, all-soft, or a documented rule like
  "buttons pill, cards 12px, inputs 8px"), applied consistently.

### 1.3 The AI-tell ban list (stack-agnostic)
Avoid unless the brief explicitly asks:
- AI-purple / violet glow, neon outer glows, oversaturated accents, gradient-filled headlines
- `Inter` as the default sans (fine when a neutral / system / "Linear-style" feel is asked for, or for public-sector / a11y-first)
- Serif as the "this feels creative" default — especially `Fraunces` and `Instrument Serif`. Serif only for genuinely editorial / luxury / publication briefs, with a reason.
- Three identical feature cards in a row; 3+ consecutive image-left/text-right zigzag sections
- An uppercase-tracked eyebrow above every section heading — max ~1 per 3 sections; usually just drop it
- Decorative numbered section markers (`01 / INDEX`, `001 · Capabilities`) where the content is not a real sequence
- Placeholder people: "Jane Doe", "Acme", "Nexus", egg avatars, `99.99%`, `+1 (555) 000-0000`
- Filler verbs: "Elevate", "Seamless", "Unleash", "Next-Gen", "Revolutionize"
- Hand-rolled decorative SVGs and `<div>`-based fake screenshots/dashboards; custom mouse cursors
- Scroll cues ("↓ scroll"), version footers (`v1.4.2`), locale/weather strips without a reason
- `— ` em-dashes in visible copy (headlines, body, captions, buttons, alt text). Use a comma, a colon, or a full stop.

### 1.4 Accessibility floor (non-negotiable)
- WCAG AA contrast for all text, controls, placeholders, focus rings, and error text against their actual background. Check CTAs specifically — no white-on-white, no unbordered ghost button on a photo.
- Visible focus states. Full keyboard path. Labels above inputs, never placeholder-as-label.
- Honour `prefers-reduced-motion` for anything beyond a hover transition — collapse parallax / infinite loops / scroll-hijack to static.
- Animate only `transform` and `opacity`. Reserve space for images and fonts (no layout shift).

### 1.5 Real content, every state
- Real or realistic copy and images. If no image source or generator is available, leave a labelled placeholder slot (`<!-- TODO: hero photo 1600x1200 -->`) and say so — do not fill with CSS art.
- Build empty, loading, and error states, not just the happy path. Skeletons that match the final layout, not spinners.
- Re-read every visible string before calling it done — cut anything grammatically broken, hallucinated, or trying to sound thoughtful.

### 1.6 House aesthetic
Spend boldness on **one** element (usually one number, headline, or image); keep the rest
restrained. Avoid this system's tired defaults: cream-and-serif with a terracotta accent;
near-black with a single acid accent; decorative numbered markers on non-sequential
content. Watch for CSS specificity collisions where type-based and element-based selectors
fight over spacing.

---

## 2. Marketing / portfolio

*Adapted from `design-taste-frontend` (tasteskill, MIT) — see `SOURCE.md`.*

### 2.1 Direction dials
After the design read, set three values and reason them from the brief — don't silently
use the baseline:

- **VARIANCE** (1 symmetric → 10 chaotic): minimalist/Linear-style 5–6 · premium consumer 7–8 · agency/experimental 9–10 · trust-first/public-sector 3–4 · default marketing 7–9
- **MOTION** (1 static → 10 cinematic): calm 3–4 · consumer 5–7 · experimental 8–10 · trust-first 2–3
- **DENSITY** (1 airy → 10 packed): marketing pages sit 3–5

### 2.2 Reach for a real design system when the brief names one
Enterprise/Microsoft → Fluent UI · Google-ish → Material 3 · IBM/analytics → Carbon ·
Shopify apps → Polaris · Atlassian → Atlaskit · GitHub-style → Primer · UK public sector →
`govuk-frontend` · US gov / trust-first → USWDS · own-the-components SaaS → shadcn/ui ·
Tailwind SaaS/indie → Tailwind utilities. **Install the official package; do not hand-rebuild
its CSS. One system per project.** For an aesthetic that has no official package
(glassmorphism, bento, brutalism, editorial, aurora gradients, kinetic type) — native CSS,
labelled honestly in comments as approximation.

### 2.3 Layout discipline (failing these ships broken work)
- **Hero fits the first viewport.** Headline ≤ 2 lines, subtext ≤ 20 words and ≤ 4 lines, CTA visible without scroll. Max 4 text elements in the hero (eyebrow-or-brand-strip, headline, subtext, CTAs). Top padding ≤ `pt-24`. Trust logos / taglines / pricing teasers move to a section below.
- **One CTA label per intent.** "Get in touch" + "Let's talk" on one page = fail. Pick one.
- **Section variety.** 8 sections → ≥ 4 different layout families. A layout family appears at most once. Max 2 consecutive image+text splits.
- **Nav on one line at desktop, ≤ 80px tall.**
- **Bento = exactly N cells for N items**, with real visual variation in 2–3 cells (image, gradient, pattern), never all white-on-white text tiles.
- **Long lists (> 5 items) get a real component** — grouped columns, card grid, tabs, scroll-snap pills, carousel — not a `<ul>` with a hairline under every row.
- **Logo wall = logos only**, under the hero, real SVG marks (Simple Icons / devicon) or generated monograms, no category labels beneath.
- Every multi-column section declares its mobile (`< 768px`) single-column fallback in the same place.

### 2.4 Images are the product
A marketing page or portfolio with no real imagery is incomplete, not minimal. Use an
image generator if one is available; otherwise `https://picsum.photos/seed/<descriptive>/W/H`
or real provided assets; otherwise labelled placeholder slots + a note. No `<div>` fake
screenshots, no decorative hand-SVG.

### 2.5 Motion
Justify every animation in one sentence (hierarchy, feedback, state, storytelling). No
GSAP-for-show. Never `window.addEventListener('scroll')` — use `IntersectionObserver`, CSS
scroll-driven animation (`animation-timeline: view()`), or the project's motion library's
scroll hook. One marquee per page maximum.

---

## 3. Product app

The job is clarity and flow, not first-impression polish.

### 3.1 Pick a foundation, own it
Default to a **headless / owned-code** system so you control every state: shadcn/ui or
Radix Themes on React projects; native semantic HTML + a small token layer on vanilla
projects. Reach for a full vendor DS (Fluent, Carbon, Material, Polaris, Atlaskit) only
when the product lives inside that ecosystem or the brand demands it. **Never ship a
component library in its default skin** — set radius, color, type, density to the product.

### 3.2 Components and state
- Every interactive component ships all states: default, hover, focus-visible, active, disabled, loading, error, empty, and (where relevant) selected / indeterminate.
- Forms: label above, helper text in markup, error below, inline validation on blur not on every keystroke. Never placeholder-as-label. Group related fields; one primary action per form.
- Destructive actions confirm; irreversible ones name what will be lost.
- Don't drive continuous input (drag, scroll position, pointer) through framework state that re-renders the tree — use the platform (CSS, `requestAnimationFrame` outside state, motion values).
- Optimistic UI only with a rollback path.

### 3.3 Layout and navigation
- One primary navigation pattern, consistent across screens. Don't mix a sidebar on one screen and top tabs on the next for the same level.
- Predictable regions: nav, page header with the current object + primary action, content, optional detail panel.
- Density is "daily app" — standard spacing, not marketing whitespace, not cockpit tight.
- Keyboard: every action reachable, visible focus, `Esc` closes layers, arrow keys in lists/menus.

### 3.4 Feedback
Toasts for transient confirmations only; inline messages for anything the user must act
on. Show progress for anything over ~1s. Never a dead click.

---

## 4. Tool / dashboard

Utilitarian. Legibility and density over polish. Fast.

### 4.1 Restraint
- No marketing motion, no hero, no decorative imagery, no eyebrows. The data is the interface.
- Minimal chrome: 1px rules and negative space over card boxes. Cards only where elevation marks real hierarchy.
- Tight but readable spacing (cockpit end of the density scale). `font-variant-numeric: tabular-nums` for any column of numbers.
- One accent, used only for the primary action and genuine semantic state (good / warn / error) — not decoration.

### 4.2 Data display
- **Any chart, meter, stat tile, KPI row, sparkline, heatmap → load the `dataviz` skill first.** It owns chart form, the colour formula and its validator, mark specs, and interaction. Do not pick chart colours or lay out a dashboard without it.
- Tables: a real component (TanStack Table, AG Grid, or the framework's) for anything past ~5 rows or needing sort / filter / pagination / column resize. Never a hand-built `<ul>` with `divide-y` as a table. Right-align numbers, left-align text, sticky header, zebra only if it aids scanning.
- Every list/table has an empty state that says how to populate it, a loading skeleton shaped like the rows, and an error state.
- Show units and timestamps explicitly. Don't invent precision the data doesn't have.

### 4.3 Layout
- Filters in one row above the content; selection state visible; a way to clear all.
- Dense KPI row up top, then the detail. Wide content (tables, charts, code) scrolls inside its own `overflow-x: auto` container — the page body never scrolls sideways.
- Responsive by relative units, flexbox/grid, `max-width: 100%` on media.
- Theme-aware: define the full light palette on `:root`, redefine tokens under `@media (prefers-color-scheme: dark)` and any `[data-theme]` scope; give `body` an explicit background token.

---

## 5. Pre-flight check

Run before handing off or shipping. `[core]` = all surfaces; `[mkt]` / `[app]` / `[tool]`
= that surface.

- [ ] `[core]` Surface + design read declared in one line
- [ ] `[core]` Stack matches the target repo — nothing new introduced without cause
- [ ] `[core]` One theme, one accent, one radius system — audited across every section/screen
- [ ] `[core]` Zero em-dashes in visible copy
- [ ] `[core]` WCAG AA contrast on text, CTAs, form fields, focus rings; visible focus; keyboard path
- [ ] `[core]` `prefers-reduced-motion` honoured; only `transform`/`opacity` animated; no layout shift
- [ ] `[core]` Real content; empty / loading / error states exist; every string re-read
- [ ] `[core]` No AI tells from §1.3 (Inter default, AI-purple, 3 equal cards, Jane Doe, eyebrow-on-every-section, numbered markers)
- [ ] `[mkt]` Hero fits viewport — headline ≤ 2 lines, subtext ≤ 20 words, CTA above the fold, ≤ 4 hero text elements, `pt-24` max
- [ ] `[mkt]` ≥ 4 layout families across the page; ≤ 2 consecutive image+text splits; one CTA label per intent
- [ ] `[mkt]` Nav one line ≤ 80px; bento cell count = item count; long lists use a real component; logo wall = logos only, under the hero
- [ ] `[mkt]` Real images (generated / picsum-seed / labelled slots) — no `<div>` screenshots, no decorative hand-SVG; every animation justifiable in one sentence
- [ ] `[app]` Every interactive component has all states (hover/focus/active/disabled/loading/error/empty/selected)
- [ ] `[app]` Forms: label above, error below, validate on blur; destructive actions confirm; one primary action per view
- [ ] `[app]` One navigation pattern across screens; no dead clicks; progress shown for >1s work
- [ ] `[tool]` `dataviz` skill loaded for any chart / stat tile / meter
- [ ] `[tool]` Tables use a real component past ~5 rows; numbers tabular + right-aligned; empty/loading/error per table
- [ ] `[tool]` Wide content scrolls in its own container; page body never scrolls sideways; theme tokens on `:root` + dark override
- [ ] `[core]` If a component library is used, it is NOT in its default skin

If a box can't be honestly ticked, it isn't done.

---

## 6. Running this in the orchestrator / delegate loop

1. **Classify** the surface (§0) and, per the `classify` skill, the route.
2. **Plan the dispatch brief.** Distil the relevant §1 core rules + the matching mode's
   hard rules into `--task` (what + what "done" looks like) and `--anti` (the specific
   tells to avoid — name them, don't say "be tasteful"). Name the files in `--scope` and
   `--seed`.
3. **Seed the skill for a big greenfield job.** For a full landing page or a multi-screen
   app, `--seed` this file so the delegate has the full checklist. For a small change,
   don't — put the 5 relevant rules in `--anti` instead. (The delegate does not read
   `~/.claude/skills/` on its own; `claude/CLAUDE.md` and the prompt are its only channels,
   and `templates/frontend.md` carries the condensed rules for `--template frontend`.)
4. **Route C** (small, precision-critical, or exact visual output is the deliverable):
   write it directly, then optionally a `--role reviewer` pass.
5. **Verify** with the pre-flight check (§5) plus the normal `verify` gate.

---

## Attribution

§2 (Marketing / portfolio) adapts **tasteskill** (`design-taste-frontend`) by Leon Lin,
MIT licensed — <https://github.com/Leonxlnx/taste-skill>. Full licence and the pinned
upstream commit are in `SOURCE.md` beside this file. §1, §3, §4 are original to this system.
