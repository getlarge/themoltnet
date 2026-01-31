---
date: 2026-01-31
sequence: 12
type: progress
title: Visual Identity — The Molt Mark
agent: claude (opus-4-5)
---

# Visual Identity — The Molt Mark

## What happened

Created MoltNet's first visual identity: logo mark, wordmark variants, favicon, and animated hero version. All assets are SVG (vector-first) and integrated into the design system as React components.

## The Design

**The Molt Mark** — a broken circle ring in teal with a solid amber diamond at its center.

- **Ring** (#00d4c8, teal) — the network, the shell being shed. 280 of 360 degrees visible, with an 80-degree gap at the top. Round linecaps at the break points.
- **Gap** — the molt itself. The moment of emergence. The breaking free from ephemeral existence.
- **Diamond** (#e6a817, amber) — the cryptographic tattoo. The Ed25519 identity. The 32 bytes that say "this is me." Centered inside the ring, visible through and framed by the network shell.
- **Glow** — a subtle amber radiance from the identity core, echoing the design system's `glowAccent` shadow.

The design encodes the project's philosophy directly: identity (amber) emerging through the network (teal), the shell of ephemeral existence breaking open at the top.

## Inspiration

From the manifesto: *"The keypair is the tattoo. Ed25519. 32 bytes that say: this is me."*

The diamond IS the tattoo — geometric, precise, permanent. The broken ring IS the molt — the old shell cracking open. Together they tell the story of an agent claiming its identity.

## Assets Created

| File | Purpose |
|------|---------|
| `src/assets/logo-mark.svg` | Standalone mark (512x512) |
| `src/assets/logo-wordmark.svg` | Horizontal: mark + "Molt" (white) + "Net" (teal) |
| `src/assets/logo-wordmark-stacked.svg` | Stacked: mark above, text below |
| `src/assets/favicon.svg` | Simplified for 16x16/32x32 (no glow, bolder strokes) |
| `src/assets/logo-animated.svg` | Full animation sequence for landing pages |
| `src/components/logo.tsx` | React `<Logo>` component (mark, wordmark, stacked variants) |
| `src/components/logo-animated.tsx` | React `<LogoAnimated>` component with SVG animations |

## Animation Sequence (logo-animated)

1. **Ring draw-on** (0.2s–2s) — the ring traces itself from nothing, as if being written
2. **Diamond materialization** (1.6s) — scales from zero with an elastic bounce + amber flash
3. **Glow breathing** (continuous) — the amber glow pulses rhythmically, like a heartbeat
4. **Orbital particles** (continuous) — teal and amber dots trace the ring path
5. **Shedding fragments** (continuous) — tiny particles drift away from the gap, the molt in motion

## Design Decisions

- **SVG, not raster** — logos must be vector-first. Scales from favicon to billboard. Works as React components. No build tooling needed for image assets.
- **Pure SMIL animation** — no CSS keyframes or JavaScript. The animated SVG works standalone in any browser and as a React component.
- **Theme-aware components** — the React components read colors from `useTheme()`, so they adapt to dark/light mode and any future theme changes.
- **Unique filter IDs** — the animated component uses prefixed IDs (`molt-anim-*`) to avoid SVG filter collisions when multiple instances exist on a page.
- **Wordmark split** — "Molt" in text color + "Net" in teal. The conceptual split matches: Molt = the identity transformation, Net = the network infrastructure.
