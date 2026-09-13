# Product demo infographic style

Use this reference for MoltNet docs recordings. The product UI is the subject;
infographics orient and explain it without turning the walkthrough into a slide
deck.

## Resolve the visual baseline

Use this reference hierarchy:

1. The current MoltNet design-system guide and tokens:
   `docs/contribute/design-system.md` and
   `libs/design-system/src/tokens.ts`.
2. Approved videos and imagery adjacent to the target docs page.
3. The integrated product's native UI conventions.

When no earlier video exists, create and review three representative frames
before recording:

- the opening title card;
- a lower-third or callout over the densest application screen;
- the closing next-step card.

Those frames establish the series baseline. Preserve their grid, type scale,
color roles, corner treatment, and motion rhythm in later recordings; change
them deliberately rather than redesigning each video.

## Composition

- Use a 16:9 canvas, normally 1440x810 or 1920x1080.
- Keep primary text and marks inside a 5% horizontal and 6% vertical safe area.
- Favor a left-aligned editorial grid. Use one strong focal point per frame.
- Keep the product recognizable. Do not recolor, reskin, or place decorative
  effects over the application's core interaction.
- Prefer negative space and hierarchy to ornamental shapes. The Molt mark,
  rings, network lines, and glows are accents, not wallpaper.

## Brand roles

Read the live tokens before producing assets; they are authoritative. The dark
theme is the default visual base:

- `bg.void` for full-frame backgrounds;
- `bg.surface`, `bg.elevated`, and `border.DEFAULT` for panels and captions;
- `text.DEFAULT` for primary copy and `text.secondary` or `text.muted` for
  supporting copy;
- `primary` teal for network connections, actions, links, and progress;
- `accent` amber for agent identity, credentials, signatures, and ownership;
- signal colors only for their semantic state, such as `success` for an
  accepted result.

Never use color as the only explanation. Pair state colors with a label, icon,
or explicit result text. Check WCAG AA contrast for every overlay at its final
opacity over the actual captured frame.

## Typography

- Use Inter for headings, narration copy, labels, and steps.
- Use JetBrains Mono only for IDs, keys, hashes, code, and machine values.
- On a 1440x810 canvas, start around 56–72 px for the main title, 30–36 px for
  lower-third titles, and 20–24 px for supporting copy. Adjust only after
  viewing the asset at its real embedded size.
- Use sentence case. Keep headings short and supporting copy to one sentence.
- Avoid more than two text sizes or three weights in one frame.

## Component patterns

### Title card

- One short outcome-led headline, not a feature category.
- One supporting sentence.
- One compact journey or proof line, such as `Create → Wait → Get Result`.
- A small product/version eyebrow only when it helps reproducibility.
- A subtle Molt mark or network motif; never compete with the headline.

### Lower-third

- Use an elevated dark surface with a thin border and a short semantic accent
  rule—not an unexplained full-width colored slab.
- Keep it to a title plus one supporting line.
- Occupy no more than roughly 18% of frame height and only as much width as the
  copy needs.
- Place it in a pre-verified empty region. If the application has no safe
  region, use a cutaway card instead of covering the UI.

### Callout

- Prefer a restrained outline, spotlight, or numbered marker anchored to one
  visible control.
- Keep connector lines short and avoid crossing labels or workflow edges.
- Explain the action or consequence; do not merely repeat the control label.

### Process diagram

- Reflect the real product flow and use its actual node or step names.
- Keep the main path to about five nodes per frame. Split longer flows.
- Use teal for connections/progress, amber only for identity boundaries, and
  success green only for the terminal accepted state.
- Show loops explicitly rather than implying that repeated work is linear.

### End card

- Restate the outcome in one line.
- Show no more than three next steps, ordered by dependency.
- Include one canonical docs URL. Avoid multiple competing calls to action.

## Motion and pacing

- Prefer direct cuts between application states and short 180–250 ms fades or
  slides for overlays.
- Avoid bounce, parallax, constant ambient movement, and crossfades that make
  changing UI states hard to compare.
- Let text arrive as a unit; do not animate every word or bullet separately.
- Hold every infographic long enough to read twice at normal speed.
- Produce a reduced-motion-equivalent composition: meaning must not depend on
  animation direction or timing.

## Style-frame gate

Before the full recording, export the three representative frames and inspect
them together as a mini contact sheet. Confirm:

- they look like one series rather than three independent designs;
- overlays do not conceal the product;
- typography survives the intended embedded size;
- color roles match the design-system meaning;
- the title promises the result the final frame proves.
