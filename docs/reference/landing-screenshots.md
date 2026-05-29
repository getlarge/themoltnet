# Landing Screenshots

The three product shots on the landing page (`Collaboration` section) — the
task board, the live execution pane, and the create-task dialog — are captured
from **hand-authored HTML mockups**, not from the running console.

## Why mockups, not real screenshots

A real capture needs the full Docker stack plus a provisioned agent actually
executing a task to populate the live pane — heavy, slow, and flaky. The
mockups use the real design-system token values (`--void`, `--surface`,
`--primary` teal, `--accent` amber, JetBrains Mono), so they read as the
product at a glance.

**The trade-off:** mockups can drift from the real React components over time.
They are "looks like the product," not "is the product." That is acceptable
**only because regenerating them is cheap** — a single command, documented
below. If a mockup ever diverges enough to mislead, fix the HTML and re-run.

## Where the source lives

- Mockup HTML: `apps/landing/screenshots/src/{board,live-pane,create-task}.html`
- Capture script: `apps/landing/screenshots/capture.mjs`
- Captured PNGs (served by the landing app at `/screenshots/*.png`):
  `apps/landing/public/screenshots/{board,live-pane,create-task}.png`

Each HTML file is self-contained (inline CSS, fixed 1280px body width) and uses
the token hex values copied from `libs/design-system/src/tokens.ts`. If the
design tokens change, update the `:root` block in each mockup.

## Regenerating the screenshots

1. Edit the relevant file under `apps/landing/screenshots/src/`.
2. Run the capture script from the repo root:
   ```bash
   node apps/landing/screenshots/capture.mjs
   ```
   It renders each mockup with Playwright (Chromium) at a fixed 1280px width,
   `deviceScaleFactor: 2` (so the output PNGs are 2× / retina-sharp), dark
   color scheme, and clips each capture to the mockup's actual content height —
   no dead space below. The PNGs are written straight to
   `apps/landing/public/screenshots/`.
3. Commit the HTML change and the regenerated PNG(s) together so the source and
   the asset never drift apart.

The script imports `chromium` from `@playwright/test`, which is already a
workspace dependency (used by the console e2e suite). No extra install is
needed beyond `pnpm install`.

## When to refresh

Refresh after any console UI change that visibly affects the **lane board**,
the **live pane**, or the **create-task dialog** — for example a new lane, a
restyled turn stream, or new fields in the create flow. The corresponding
components live in `libs/task-ui/src/` (`task-lane-board.tsx`,
`task-live-pane.tsx`, `create-task-dialog.tsx`).
