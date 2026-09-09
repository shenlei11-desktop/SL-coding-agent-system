# Source and attribution

Section 2 of `SKILL.md` (**Marketing / portfolio**) is a distilled, stack-neutral
adaptation of the **tasteskill** frontend skill.

| | |
|---|---|
| Upstream | https://github.com/Leonxlnx/taste-skill |
| Skill | `skills/taste-skill/SKILL.md` (install name `design-taste-frontend`) |
| Author | Leon Lin (`Leonxlnx`) |
| Licence | MIT (see `LICENSE`) |
| Pinned at | commit `ccbc15639c97057cbfcf32ecebc38ef716e4bb37` (2026-08-24) |
| Vendored | 2026-09-09 |

## What was changed

- **Trimmed** ~1,200 lines to the parts that carry taste rather than stack opinion:
  brief inference, the direction dials, the design-system map, the layout/typography/
  colour discipline, the AI-tell ban list, the dark-mode protocol, and the pre-flight
  essentials.
- **Removed the hard stack assumption.** Upstream assumes React / Next RSC / Tailwind v4 /
  Motion / GSAP. This system's frontends are often vanilla HTML/CSS/JS with no build. §1.1
  makes "match the target repo" the rule; the framework-specific mechanics (`'use client'`
  isolation, `useMotionValue`, `next/font`, Tailwind class strings) were dropped or
  generalised.
- **Added surfaces upstream excludes.** Upstream is landing/portfolio only and defers apps
  and dashboards to "use a vendor design system." §3 (Product app) and §4 (Tool /
  dashboard) are original, and §4 hands charts to the `dataviz` skill.
- **Folded in the house rules** from `claude/CLAUDE.md` (§1.6) and the orchestrator/
  delegate workflow (§6).
- **Kept the em-dash ban**, restated for plain CSS/HTML rather than Tailwind.

## Updating from upstream

Re-read `skills/taste-skill/SKILL.md` at a newer commit, diff against the pinned one
above, and fold any genuinely new taste rules into §1–§2. Do not re-import the
stack-specific material. Bump the "Pinned at" line when you do.
