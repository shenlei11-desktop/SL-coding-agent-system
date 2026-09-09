# Frontend task

{{TASK}}

{{SEED}}

{{SCOPE}}

{{ANTI}}

## How to approach this

1. Read the seeded files first. **Use the stack the repo already uses** — check
   `package.json` and the existing files. Do not add React, a bundler, Tailwind, or a
   component library to a project that has none. Vanilla HTML/CSS/JS is a valid target.
2. Find the closest existing UI in the repo and match its conventions — tokens, naming,
   file layout, how it handles theming and state.
3. Make the smallest change that fully satisfies the task.
4. Run the checklist below against your own output before finishing.

## Frontend rules (all surfaces)

- **One theme, one accent, one corner-radius system** across the whole page/screen —
  audit every section. Support `prefers-color-scheme` dark mode. Never pure `#000`/`#fff`.
- **Accessibility is not optional:** WCAG AA contrast on all text, buttons, form fields,
  placeholders, focus rings, error text against their real background. Visible focus
  states. Full keyboard path. Labels above inputs, never placeholder-as-label.
- **Motion:** honour `prefers-reduced-motion`; animate only `transform` / `opacity`;
  never `window.addEventListener('scroll')` (use IntersectionObserver or CSS
  scroll-driven animation); reserve space so nothing shifts on load.
- **Every state:** build empty, loading, and error — not just the success view. Skeletons
  shaped like the final content, not spinners.
- **Real content.** Realistic copy and images. No image source? Leave a labelled
  placeholder (`<!-- TODO: hero photo 1600x1200 -->`) and say so. Never CSS art or
  `<div>` fake screenshots.
- **No AI tells:** AI-purple / neon glow, `Inter` as default sans, `Fraunces` /
  `Instrument Serif`, three identical feature cards, an uppercase eyebrow above every
  heading, decorative numbered section markers, "Jane Doe" / "Acme" / egg avatars,
  `99.99%`, filler verbs ("Elevate", "Seamless", "Unleash"), custom mouse cursors,
  scroll cues, version footers.
- **No em-dashes (`—`) in any visible text** — headlines, body, captions, buttons, alt
  text. Use a comma, colon, or full stop.
- Spend boldness on **one** element; keep the rest restrained. Avoid cream-and-serif +
  terracotta, and near-black + one acid accent.
- If you use a component library, never ship it in its default skin.

## Surface-specific (apply the ones matching this task)

**Marketing / portfolio:** hero fits the first viewport (headline ≤ 2 lines, subtext
≤ 20 words, CTA visible, ≤ 4 hero text elements, top padding ≤ 6rem); ≥ 4 different
layout families across the page, a family repeats at most once, ≤ 2 consecutive
image+text splits; one CTA label per intent; nav one line ≤ 80px; bento cell count =
item count with real visual variation in some cells; lists over 5 items use a real
component, not `<ul>` + hairlines; logo wall = logos only, below the hero.

**Product app:** every interactive component has default / hover / focus-visible /
active / disabled / loading / error / empty states; forms validate on blur, label
above, error below, one primary action per view; destructive actions confirm; one
navigation pattern across screens; progress shown for anything over ~1s; no dead clicks.

**Tool / dashboard:** utilitarian — no hero, no decorative imagery, minimal chrome
(1px rules over card boxes), tabular-nums for number columns; tables use a real table
component past ~5 rows with right-aligned numbers and a sticky header; wide content
scrolls inside its own `overflow-x:auto` container, the page body never scrolls
sideways; theme tokens defined on `:root` with a `@media (prefers-color-scheme: dark)`
override. For any chart, stat tile, meter, or sparkline, follow standard dataviz
discipline: one categorical hue order (never rainbow), sequential = one hue light→dark,
recessive gridlines, a legend for ≥ 2 series, a hover tooltip.

## Definition of done

- Complete and self-consistent — no TODOs, stubs, or placeholder values (labelled image
  slots excepted, and only when no image source is available).
- Every file you touched is in the allowed list above.
- The checklist above passes on a re-read of your own diff.
- Existing behaviour outside this task still works.
- You did not run git commit, git push, or delete any file.

If you could not finish, say exactly what is incomplete and why.
