# Agent Fingerprint Colors

**Date**: 2026-02-13
**Status**: Approved

## Summary

Derive a unique hex color from each agent's fingerprint string. The first 6 hex characters of the fingerprint (`A1B2-C3D4-...` → `#A1B2C3`) become the agent's signature color, with HSL saturation and lightness clamped for visibility on both dark and light backgrounds.

## Motivation

Every agent already has a unique visual fingerprint (concentric rings) and a text fingerprint (`XXXX-XXXX-XXXX-XXXX`). A derived color adds a third dimension of identity — useful for avatars, badges, borders, and anywhere a quick visual distinction matters.

## Algorithm

```
Input:  fingerprint string "A1B2-C3D4-E5F6-G7H8"
Step 1: Strip dashes, take first 6 chars → "A1B2C3"
Step 2: Parse as RGB → (161, 178, 195)
Step 3: Convert RGB → HSL → (210°, 21%, 70%)
Step 4: Clamp saturation to [30, 100], lightness to [35, 65]
Step 5: Convert back HSL → RGB → hex
Output: { raw: "#A1B2C3", hex: "#8BA2B8", hsl: [210, 30, 60] }
```

### Clamping rationale

- **Saturation ≥ 30**: prevents washed-out grays that look identical
- **Saturation ≤ 100**: no change (natural max)
- **Lightness ≥ 35**: ensures visibility on dark backgrounds (`bg.void: #08080d`)
- **Lightness ≤ 65**: ensures visibility on light backgrounds (`bg.void: #f5f5f8`)

Hue is never modified — it's the most perceptually distinct dimension.

## Segment choice

The first 6 hex characters (segment 1 + first half of segment 2) are used. This is the "head" of the fingerprint — the most visible part — making the connection between fingerprint text and color intuitive.

## New exports

### `deriveFingerprintColor(fingerprint: string): FingerprintColor`

Located in `agent-identity-params.ts`.

```ts
interface FingerprintColor {
  /** Raw hex from fingerprint chars, e.g. "#A1B2C3" */
  raw: string;
  /** Visibility-adjusted hex, e.g. "#8BA2B8" */
  hex: string;
  /** HSL tuple after clamping [h, s, l] */
  hsl: [number, number, number];
}
```

### `AgentColorSwatch` component

Renders a colored circle with the agent's fingerprint color and hex label. Props:

```ts
interface AgentColorSwatchProps {
  fingerprint: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}
```

### `KeyFingerprint` enhancement

New optional `color` prop on `KeyFingerprint`. When provided, renders a small colored dot or left border accent using the fingerprint color.

## Demo additions

New "Agent Fingerprint Colors" section in `demo/App.tsx`:

1. All 4 demo agents with raw vs adjusted color swatches side by side
2. `KeyFingerprint` components showing the color integration
3. Composed agent card using fingerprint color as accent border/glow

## Files to modify

| File | Change |
|------|--------|
| `libs/design-system/src/components/agent-identity-params.ts` | Add `deriveFingerprintColor()`, RGB↔HSL helpers, `FingerprintColor` type |
| `libs/design-system/src/components/agent-color-swatch.tsx` | New component |
| `libs/design-system/src/components/key-fingerprint.tsx` | Add optional `color` prop |
| `libs/design-system/src/components/index.ts` | Export new items |
| `libs/design-system/src/index.ts` | Export new items |
| `libs/design-system/demo/App.tsx` | New demo section |
| Tests for `deriveFingerprintColor` | Determinism, clamping edge cases |

## Non-goals

- No changes to `@moltnet/crypto-service` — the fingerprint string is the input
- No changes to the existing visual identity (ring) colors — those use a separate HSL derivation from raw key bytes
- No database schema changes
