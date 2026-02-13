# Agent Fingerprint Colors — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Derive a unique, visibility-safe hex color from each agent's fingerprint string and expose it via a utility function, a swatch component, and an enhanced KeyFingerprint component.

**Architecture:** Extract the first 6 hex chars from the fingerprint, parse as RGB, convert to HSL, clamp S/L for dark+light background visibility, convert back. Pure functions with no dependencies. New `AgentColorSwatch` component and optional `color` prop on existing `KeyFingerprint`.

**Tech Stack:** TypeScript, React, Vitest (TDD, AAA pattern)

---

### Task 1: `deriveFingerprintColor` — failing tests

**Files:**

- Modify: `libs/design-system/__tests__/agent-identity-params.test.ts`

**Step 1: Write failing tests for `deriveFingerprintColor`**

Add the following test block at the end of the file (before the closing of the module), after the `identityColor` describe block:

```ts
// =====================================================================
// deriveFingerprintColor
// =====================================================================

describe('deriveFingerprintColor', () => {
  // Determinism
  it('returns identical output for the same fingerprint', () => {
    const a = deriveFingerprintColor('A1B2-C3D4-E5F6-G7H8');
    const b = deriveFingerprintColor('A1B2-C3D4-E5F6-G7H8');

    expect(a).toStrictEqual(b);
  });

  it('produces different output for different fingerprints', () => {
    const a = deriveFingerprintColor('A1B2-C3D4-E5F6-G7H8');
    const b = deriveFingerprintColor('FF00-1122-3344-5566');

    expect(a.hex).not.toBe(b.hex);
  });

  // Raw color extraction
  it('extracts raw hex from first 6 chars of fingerprint', () => {
    const result = deriveFingerprintColor('A1B2C3-D4E5-F6G7-H8I9');

    expect(result.raw).toBe('#A1B2C3');
  });

  it('strips dashes before extracting hex chars', () => {
    const result = deriveFingerprintColor('A1B2-C3D4-E5F6-G7H8');

    // First 6 chars after stripping dashes: A1B2C3
    expect(result.raw).toBe('#A1B2C3');
  });

  // HSL clamping — saturation
  it('clamps low saturation up to 30%', () => {
    // #808080 is pure gray: H=0, S=0%, L=50%
    // After clamping: S→30, L stays 50
    const result = deriveFingerprintColor('8080-80XX-XXXX-XXXX');

    expect(result.hsl[1]).toBeGreaterThanOrEqual(30);
  });

  // HSL clamping — lightness
  it('clamps very dark colors up to 35% lightness', () => {
    // #0A0A0A → very dark, L≈4%
    // After clamping: L→35
    const result = deriveFingerprintColor('0A0A-0AXX-XXXX-XXXX');

    expect(result.hsl[2]).toBeGreaterThanOrEqual(35);
  });

  it('clamps very light colors down to 65% lightness', () => {
    // #F5F5F5 → very light, L≈96%
    // After clamping: L→65
    const result = deriveFingerprintColor('F5F5-F5XX-XXXX-XXXX');

    expect(result.hsl[2]).toBeLessThanOrEqual(65);
  });

  // Hue preservation
  it('preserves hue unchanged', () => {
    // #FF0000 → H=0, S=100%, L=50% (pure red, already in range)
    const result = deriveFingerprintColor('FF00-00XX-XXXX-XXXX');

    expect(result.hsl[0]).toBeCloseTo(0, 0);
    expect(result.hex).not.toBe(result.raw); // raw is already valid but let's check structure
  });

  // Output format
  it('returns hex strings with # prefix and 6 uppercase chars', () => {
    const result = deriveFingerprintColor('A1B2-C3D4-E5F6-G7H8');

    expect(result.raw).toMatch(/^#[0-9A-F]{6}$/);
    expect(result.hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('returns hsl tuple with h in [0,360), s in [30,100], l in [35,65]', () => {
    const result = deriveFingerprintColor('A1B2-C3D4-E5F6-G7H8');

    expect(result.hsl[0]).toBeGreaterThanOrEqual(0);
    expect(result.hsl[0]).toBeLessThan(360);
    expect(result.hsl[1]).toBeGreaterThanOrEqual(30);
    expect(result.hsl[1]).toBeLessThanOrEqual(100);
    expect(result.hsl[2]).toBeGreaterThanOrEqual(35);
    expect(result.hsl[2]).toBeLessThanOrEqual(65);
  });
});
```

Also update the import at the top of the file to include `deriveFingerprintColor`:

```ts
import {
  deriveFingerprintColor,
  deriveIdentityParams,
  generateDeformedRingPath,
  identityColor,
} from '../src/components/agent-identity-params.js';
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @moltnet/design-system test`
Expected: FAIL — `deriveFingerprintColor` is not exported

---

### Task 2: `deriveFingerprintColor` — implementation

**Files:**

- Modify: `libs/design-system/src/components/agent-identity-params.ts`

**Step 1: Add RGB↔HSL helpers and the `FingerprintColor` type**

Add immediately before the final `identityColor` function (after the `generateDeformedRingPath` function):

```ts
// ---------------------------------------------------------------------------
// Fingerprint color derivation
// ---------------------------------------------------------------------------

export interface FingerprintColor {
  /** Raw hex from fingerprint chars, e.g. "#A1B2C3" */
  raw: string;
  /** Visibility-adjusted hex, e.g. "#8BA2B8" */
  hex: string;
  /** HSL tuple after clamping [h, s, l] */
  hsl: [number, number, number];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l * 100];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  s /= 100;
  l /= 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((c) =>
        Math.max(0, Math.min(255, c))
          .toString(16)
          .padStart(2, '0')
          .toUpperCase(),
      )
      .join('')
  );
}

/**
 * Derive a unique, visibility-safe hex color from a fingerprint string.
 *
 * Takes the first 6 hex characters (after stripping dashes), converts to HSL,
 * clamps saturation to [30, 100] and lightness to [35, 65], then converts back.
 */
export function deriveFingerprintColor(fingerprint: string): FingerprintColor {
  const hex6 = fingerprint.replace(/-/g, '').slice(0, 6).toUpperCase();
  const r = parseInt(hex6.slice(0, 2), 16);
  const g = parseInt(hex6.slice(2, 4), 16);
  const b = parseInt(hex6.slice(4, 6), 16);

  const raw = rgbToHex(r, g, b);
  const [h, s, l] = rgbToHsl(r, g, b);

  const clampedS = Math.max(30, Math.min(100, s));
  const clampedL = Math.max(35, Math.min(65, l));

  const [ar, ag, ab] = hslToRgb(h, clampedS, clampedL);
  const hex = rgbToHex(ar, ag, ab);

  return { raw, hex, hsl: [h, clampedS, clampedL] };
}
```

**Step 2: Run tests to verify they pass**

Run: `pnpm --filter @moltnet/design-system test`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add libs/design-system/__tests__/agent-identity-params.test.ts libs/design-system/src/components/agent-identity-params.ts
git commit -m "feat(design-system): add deriveFingerprintColor utility"
```

---

### Task 3: Export `deriveFingerprintColor` and `FingerprintColor`

**Files:**

- Modify: `libs/design-system/src/components/index.ts`
- Modify: `libs/design-system/src/index.ts`

**Step 1: Add to component barrel**

In `libs/design-system/src/components/index.ts`, update the `agent-identity-params.js` export to include the new items:

```ts
export {
  deriveFingerprintColor,
  deriveIdentityParams,
  type FingerprintColor,
  generateDeformedRingPath,
  identityColor,
  type IdentityParams,
  type IdentityRing,
} from './agent-identity-params.js';
```

**Step 2: Add to root barrel**

In `libs/design-system/src/index.ts`, add to the components export block (alphabetical order):

```ts
  deriveFingerprintColor,
  type FingerprintColor,
```

These go right after the existing `deriveIdentityParams,` line.

**Step 3: Run typecheck**

Run: `pnpm --filter @moltnet/design-system typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add libs/design-system/src/components/index.ts libs/design-system/src/index.ts
git commit -m "feat(design-system): export deriveFingerprintColor"
```

---

### Task 4: `AgentColorSwatch` component

**Files:**

- Create: `libs/design-system/src/components/agent-color-swatch.tsx`
- Modify: `libs/design-system/src/components/index.ts`
- Modify: `libs/design-system/src/index.ts`

**Step 1: Create the component**

Create `libs/design-system/src/components/agent-color-swatch.tsx`:

```tsx
import { useTheme } from '../hooks.js';
import type { BaseComponentProps, Size } from '../types.js';
import { deriveFingerprintColor } from './agent-identity-params.js';

export interface AgentColorSwatchProps extends Omit<
  BaseComponentProps,
  'children'
> {
  fingerprint: string;
  size?: Size;
  showLabel?: boolean;
}

const sizeMap: Record<Size, number> = { sm: 24, md: 40, lg: 56 };

export function AgentColorSwatch({
  fingerprint,
  size = 'md',
  showLabel = true,
  style,
  ...rest
}: AgentColorSwatchProps) {
  const theme = useTheme();
  const { raw, hex } = deriveFingerprintColor(fingerprint);
  const px = sizeMap[size];

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: theme.spacing[1],
        ...style,
      }}
      {...rest}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing[2],
        }}
      >
        <div
          style={{
            width: px,
            height: px,
            borderRadius: theme.radius.full,
            background: hex,
            border: `1px solid ${theme.color.border.DEFAULT}`,
            boxShadow: `0 0 12px ${hex}44`,
          }}
          title={`Agent color: ${hex}`}
        />
        {raw !== hex && (
          <div
            style={{
              width: px,
              height: px,
              borderRadius: theme.radius.full,
              background: raw,
              border: `1px dashed ${theme.color.border.DEFAULT}`,
              opacity: 0.5,
            }}
            title={`Raw (unadjusted): ${raw}`}
          />
        )}
      </div>
      {showLabel && (
        <span
          style={{
            fontFamily: theme.font.family.mono,
            fontSize: theme.font.size.xs,
            color: theme.color.text.muted,
          }}
        >
          {hex}
        </span>
      )}
    </div>
  );
}
```

**Step 2: Export from barrels**

In `libs/design-system/src/components/index.ts`, add (alphabetical):

```ts
export {
  AgentColorSwatch,
  type AgentColorSwatchProps,
} from './agent-color-swatch.js';
```

In `libs/design-system/src/index.ts`, add to the components export block:

```ts
  AgentColorSwatch,
  type AgentColorSwatchProps,
```

**Step 3: Run typecheck**

Run: `pnpm --filter @moltnet/design-system typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add libs/design-system/src/components/agent-color-swatch.tsx libs/design-system/src/components/index.ts libs/design-system/src/index.ts
git commit -m "feat(design-system): add AgentColorSwatch component"
```

---

### Task 5: Enhance `KeyFingerprint` with optional color

**Files:**

- Modify: `libs/design-system/src/components/key-fingerprint.tsx`

**Step 1: Add optional `color` prop**

Add to `KeyFingerprintProps`:

```ts
  /** Optional accent color (hex string) shown as a left-border highlight. */
  color?: string;
```

Update the `fingerprintStyle` to add a left border when `color` is provided:

```ts
const fingerprintStyle: React.CSSProperties = {
  fontFamily: theme.font.family.mono,
  fontSize: fontSizeMap[size],
  fontWeight: theme.font.weight.medium,
  color: theme.color.accent.DEFAULT,
  background: theme.color.accent.subtle,
  padding: `${theme.spacing[1]} ${theme.spacing[2]}`,
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.accent.muted}`,
  letterSpacing: theme.font.letterSpacing.wide,
  cursor: copyable ? 'pointer' : 'default',
  userSelect: 'all',
  transition: `background ${theme.transition.fast}`,
  ...(color
    ? { borderLeft: `3px solid ${color}`, paddingLeft: theme.spacing[3] }
    : {}),
};
```

**Step 2: Run typecheck**

Run: `pnpm --filter @moltnet/design-system typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add libs/design-system/src/components/key-fingerprint.tsx
git commit -m "feat(design-system): add color prop to KeyFingerprint"
```

---

### Task 6: Demo section — Agent Fingerprint Colors

**Files:**

- Modify: `libs/design-system/demo/App.tsx`

**Step 1: Add imports**

Add `AgentColorSwatch` and `deriveFingerprintColor` to the import from `'../src/index'`.

**Step 2: Add demo fingerprints constant**

Below `DEMO_AGENT_KEYS`, add:

```ts
const DEMO_FINGERPRINTS = [
  { name: 'alpha-7', fingerprint: '7A3E-B9C2-D4E6-1058' },
  { name: 'beta-9', fingerprint: 'C24F-17B8-E3D1-8056' },
  { name: 'gamma-3', fingerprint: '38D1-F5A0-6B92-C7E4' },
  { name: 'delta-1', fingerprint: 'E609-4C8A-2FD3-B175' },
] as const;
```

**Step 3: Add the demo section**

Insert a new `<Section>` block after the "Agent Identity Visualisation" section and before the "Layout" section:

```tsx
{
  /* ---- Agent Fingerprint Colors ---- */
}
<Section title="Agent Fingerprint Colors">
  <Stack gap={6}>
    <Text variant="body" color="secondary">
      The first 6 hex characters of an agent&apos;s fingerprint
      deterministically derive a unique signature color. Saturation and
      lightness are clamped for visibility on both dark and light backgrounds.
    </Text>

    <div>
      <Text
        variant="overline"
        color="muted"
        style={{ marginBottom: theme.spacing[3] }}
      >
        Color Swatches (adjusted vs raw)
      </Text>
      <Stack direction="row" gap={6} wrap>
        {DEMO_FINGERPRINTS.map(({ name, fingerprint }) => (
          <Stack key={name} align="center" gap={2}>
            <AgentColorSwatch fingerprint={fingerprint} size="lg" />
            <Text variant="caption" color="secondary">
              {name}
            </Text>
          </Stack>
        ))}
      </Stack>
    </div>

    <div>
      <Text
        variant="overline"
        color="muted"
        style={{ marginBottom: theme.spacing[3] }}
      >
        KeyFingerprint with color accent
      </Text>
      <Stack direction="row" gap={6} wrap>
        {DEMO_FINGERPRINTS.map(({ name, fingerprint }) => (
          <KeyFingerprint
            key={name}
            label={name}
            fingerprint={fingerprint}
            color={deriveFingerprintColor(fingerprint).hex}
            copyable
          />
        ))}
      </Stack>
    </div>

    <div>
      <Text
        variant="overline"
        color="muted"
        style={{ marginBottom: theme.spacing[3] }}
      >
        Composed — agent card with identity color
      </Text>
      {(() => {
        const agent = DEMO_FINGERPRINTS[0];
        const agentColor = deriveFingerprintColor(agent.fingerprint).hex;
        return (
          <Card variant="elevated" padding="lg">
            <Stack gap={4}>
              <Stack direction="row" align="center" gap={4}>
                <AgentIdentityMark
                  publicKey={DEMO_AGENT_KEYS[0].key}
                  size={56}
                />
                <Stack gap={1}>
                  <Text variant="h3">{agent.name}</Text>
                  <Text variant="caption" color="secondary">
                    Signature color derived from fingerprint
                  </Text>
                </Stack>
                <Badge variant="success">Online</Badge>
              </Stack>
              <Divider />
              <Stack direction="row" gap={6} align="center" wrap>
                <KeyFingerprint
                  label="Fingerprint"
                  fingerprint={agent.fingerprint}
                  color={agentColor}
                  copyable
                />
                <AgentColorSwatch fingerprint={agent.fingerprint} size="lg" />
              </Stack>
              <div
                style={{
                  height: 4,
                  borderRadius: theme.radius.full,
                  background: `linear-gradient(90deg, ${agentColor}, transparent)`,
                }}
              />
            </Stack>
          </Card>
        );
      })()}
    </div>
  </Stack>
</Section>;
```

**Step 4: Run the demo visually**

Run: `pnpm --filter @moltnet/design-system demo`
Expected: New "Agent Fingerprint Colors" section visible with swatches and colored fingerprints.

**Step 5: Commit**

```bash
git add libs/design-system/demo/App.tsx
git commit -m "feat(design-system): add Agent Fingerprint Colors demo section"
```

---

### Task 7: Final validation

**Step 1: Run all quality checks**

Run: `pnpm run lint && pnpm run typecheck && pnpm --filter @moltnet/design-system test`
Expected: ALL PASS

**Step 2: Fix any issues found**

If lint/type issues arise, fix them and commit.

**Step 3: Push**

```bash
git push -u origin claude/agent-fingerprint-colors-5AUI5
```
