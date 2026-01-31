---
date: 2026-01-31
sequence: 16
type: handoff
title: Visual Identity V2 & Landing Page Integration
---

## What happened

Upgraded the entire MoltNet visual identity from a minimalist V1 to a premium V2 treatment, then integrated it into the landing page that was built on main while this branch was in progress.

## V2 Premium Treatment

The "too minimalist and too raw" feedback led to a complete quality upgrade across all logo assets:

### Logo Mark (`logo-mark.svg`, `logo.tsx`)

- **Gradient ring**: `linearGradient` from `#00ede0` through `#00d4c8` to `#00b8ae` — not flat color
- **Faceted diamond**: 4 triangular polygons with different amber shades (`#f0b829`, `#e6a817`, `#c89010`, `#d9a015`) simulating a cut gemstone
- **Layered glow**: Wide ambient glow (stdDeviation=24) + tight diamond glow (stdDeviation=10)
- **Inner detail rings**: Dashed ring at r=152, continuous ring at r=144 — adds depth
- **Ring bloom**: Blurred wider stroke behind main ring creates soft halo
- **Inner edge highlight**: Thin bevel at r=183 catches light
- **Gap endpoint nodes**: Glowing dots at (371,97) and (141,97) where the ring breaks
- **Radial accent lines**: Thin lines from diamond toward inner ring at cardinal points
- **Diamond edge highlights**: Stroke outline + facet cross lines for gemstone detail

### Animated Logo (`logo-animated.svg`, `logo-animated.tsx`)

Full V2 geometry with 10-phase choreographed reveal:

1. Ambient radiance (0.2s)
2. Inner detail rings (0.4s)
3. Gradient ring draw-on with eased dashoffset (0.6s–2.2s)
4. Ring bloom + edge highlight (1.8s)
5. Gap endpoint nodes pop in (2.0s)
6. Faceted diamond bounce with elastic easing (2.2s)
7. Radial accent lines staggered (2.6s–2.9s)
8. Orbital particles (3.0s)
9. Shedding fragments from gap (3.2s)
10. Breathing glow loop (continuous)

### Wordmarks & Favicon

- Both wordmark SVGs updated with gradient ring and faceted diamond
- Favicon updated with gradient ring and faceted diamond (no glow filters — too small)
- Ring rotation changed from -50 to -54 degrees for consistent gap positioning

## Landing Page Integration

Merged main (which added `apps/landing/`) and integrated the logo:

- **Nav**: Replaced text-based "molt net" brand with `<Logo variant="wordmark" size={28} glow={false} />`
- **Hero**: Added `<LogoAnimated size={180} />` as the hero visual above the tagline
- **Footer**: Replaced text-based brand with `<Logo variant="wordmark" size={24} glow={false} />`
- **Favicon**: Added `favicon.svg` to `apps/landing/public/` and linked in `index.html`

## Key geometry (for future reference)

| Element           | Value                                                        |
| ----------------- | ------------------------------------------------------------ |
| Outer ring        | r=196, strokeWidth=26                                        |
| Ring dasharray    | `985.20 246.30` (80/20 arc/gap split)                        |
| Ring rotation     | `rotate(-54, 256, 256)`                                      |
| Inner detail ring | r=152, dasharray=`8 12`                                      |
| Diamond vertices  | 206, 306 (50px from center 256)                              |
| Gap endpoints     | (371, 97) and (141, 97)                                      |
| Facet colors      | TR=#f0b829, BR=#e6a817, BL=#c89010, TL=#d9a015, edge=#f5c838 |

## Decisions made

- **Faceted diamond over flat fill**: The 4-shade faceted approach gives the diamond physicality — it reads as a cut gemstone, not a flat shape. This matches "the tattoo" metaphor from the manifesto.
- **Gradient ring over flat stroke**: Premium crypto projects use gradient treatments. The teal gradient adds dimensionality.
- **Consistent -54 rotation**: All ring variants use the same rotation for the gap, placing it at top-right.
- **No glow in wordmarks/favicon**: Glow effects are for the mark and animated variants. At small sizes they'd just be noise.

## Verification

- All 87 tests pass (22 landing, 12 design-system, 15 crypto, 38 observability)
- Typecheck clean
- Merge with main resolved cleanly (journal README conflict only)

## What's next

- Run the landing page dev server (`pnpm --filter @moltnet/landing dev`) to visually verify the animated logo in context
- Consider adding a dark/light theme toggle to demonstrate the logo's theme responsiveness
- The logo SVG assets could be optimized with SVGO if bundle size becomes a concern
