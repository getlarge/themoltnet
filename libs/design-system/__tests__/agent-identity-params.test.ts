import { describe, expect, it } from 'vitest';

import {
  deriveFingerprintColor,
  deriveIdentityParams,
  generateDeformedRingPath,
  identityColor,
} from '../src/components/agent-identity-params.js';

// Demo keys used in the showcase — base64-encoded 32-byte strings
const KEY_ALPHA = 'ed25519:dGhlLW1vbHRuZXQtYWdlbnQtYWxwaGEtNy1rZXktMDE=';
const KEY_BETA = 'ed25519:Y2xhdWRlLWJldGEtOS1lZDI1NTE5LWlkZW50aXR5LTI=';
const KEY_GAMMA = 'ed25519:c29waGlhLWdhbW1hLTMtY3J5cHRvLWtleS1wYWlyLTM=';

describe('deriveIdentityParams', () => {
  // -------------------------------------------------------------------
  // Determinism
  // -------------------------------------------------------------------

  it('returns identical output for the same key', () => {
    const a = deriveIdentityParams(KEY_ALPHA);
    const b = deriveIdentityParams(KEY_ALPHA);

    expect(a).toStrictEqual(b);
  });

  it('produces different output for different keys', () => {
    const a = deriveIdentityParams(KEY_ALPHA);
    const b = deriveIdentityParams(KEY_BETA);

    expect(a.idPrefix).not.toBe(b.idPrefix);
    expect(a.coreHue).not.toBe(b.coreHue);
  });

  // -------------------------------------------------------------------
  // Prefix stripping
  // -------------------------------------------------------------------

  it('strips the ed25519: prefix', () => {
    const withPrefix = deriveIdentityParams(KEY_ALPHA);
    const withoutPrefix = deriveIdentityParams(
      KEY_ALPHA.replace('ed25519:', ''),
    );

    expect(withPrefix).toStrictEqual(withoutPrefix);
  });

  // -------------------------------------------------------------------
  // Ring count bounds
  // -------------------------------------------------------------------

  it('produces 3–6 rings', () => {
    for (const key of [KEY_ALPHA, KEY_BETA, KEY_GAMMA]) {
      const p = deriveIdentityParams(key);
      expect(p.rings.length).toBeGreaterThanOrEqual(3);
      expect(p.rings.length).toBeLessThanOrEqual(6);
    }
  });

  // -------------------------------------------------------------------
  // Ring property ranges
  // -------------------------------------------------------------------

  it('keeps ring hues in the 0–360 range', () => {
    const p = deriveIdentityParams(KEY_ALPHA);

    for (const ring of p.rings) {
      expect(ring.hue).toBeGreaterThanOrEqual(0);
      expect(ring.hue).toBeLessThan(360);
    }
  });

  it('keeps ring saturation in 65–100', () => {
    const p = deriveIdentityParams(KEY_ALPHA);

    for (const ring of p.rings) {
      expect(ring.saturation).toBeGreaterThanOrEqual(65);
      expect(ring.saturation).toBeLessThanOrEqual(100);
    }
  });

  it('keeps ring lightness in 38–56', () => {
    const p = deriveIdentityParams(KEY_ALPHA);

    for (const ring of p.rings) {
      expect(ring.lightness).toBeGreaterThanOrEqual(38);
      expect(ring.lightness).toBeLessThanOrEqual(56);
    }
  });

  it('only produces cw or ccw rotation directions', () => {
    const p = deriveIdentityParams(KEY_ALPHA);

    for (const ring of p.rings) {
      expect(['cw', 'ccw']).toContain(ring.rotationDirection);
    }
  });

  it('produces deformFrequency in 2–7', () => {
    const p = deriveIdentityParams(KEY_ALPHA);

    for (const ring of p.rings) {
      expect(ring.deformFrequency).toBeGreaterThanOrEqual(2);
      expect(ring.deformFrequency).toBeLessThanOrEqual(7);
    }
  });

  it('orders rings from inner to outer by radiusFraction', () => {
    const p = deriveIdentityParams(KEY_ALPHA);

    for (let i = 1; i < p.rings.length; i++) {
      expect(p.rings[i].radiusFraction).toBeGreaterThan(
        p.rings[i - 1].radiusFraction,
      );
    }
  });

  it('keeps radiusFraction between 0.3 and 0.92', () => {
    const p = deriveIdentityParams(KEY_ALPHA);

    for (const ring of p.rings) {
      expect(ring.radiusFraction).toBeGreaterThanOrEqual(0.3);
      expect(ring.radiusFraction).toBeLessThanOrEqual(0.92);
    }
  });

  // -------------------------------------------------------------------
  // Global param ranges
  // -------------------------------------------------------------------

  it('keeps pulseRate in 2.5–5.5', () => {
    const p = deriveIdentityParams(KEY_ALPHA);

    expect(p.pulseRate).toBeGreaterThanOrEqual(2.5);
    expect(p.pulseRate).toBeLessThanOrEqual(5.5);
  });

  it('keeps glowIntensity in 0.15–0.45', () => {
    const p = deriveIdentityParams(KEY_ALPHA);

    expect(p.glowIntensity).toBeGreaterThanOrEqual(0.15);
    expect(p.glowIntensity).toBeLessThanOrEqual(0.45);
  });

  it('keeps coreHue in the amber spectrum (30–58)', () => {
    const p = deriveIdentityParams(KEY_ALPHA);

    expect(p.coreHue).toBeGreaterThanOrEqual(30);
    expect(p.coreHue).toBeLessThanOrEqual(58);
  });

  // -------------------------------------------------------------------
  // ID prefix
  // -------------------------------------------------------------------

  it('generates a hex id prefix from first 4 key bytes', () => {
    const p = deriveIdentityParams(KEY_ALPHA);

    expect(p.idPrefix).toMatch(/^mid-[0-9a-f]{8}$/);
  });

  it('generates unique id prefixes for different keys', () => {
    const prefixes = new Set(
      [KEY_ALPHA, KEY_BETA, KEY_GAMMA].map(
        (k) => deriveIdentityParams(k).idPrefix,
      ),
    );

    expect(prefixes.size).toBe(3);
  });
});

// =====================================================================
// generateDeformedRingPath
// =====================================================================

describe('generateDeformedRingPath', () => {
  it('returns a closed SVG path starting with M and ending with Z', () => {
    const path = generateDeformedRingPath(50, 50, 40, 0, 3, 0, 12);

    expect(path).toMatch(/^M[\d.-]+,[\d.-]+/);
    expect(path).toMatch(/Z$/);
  });

  it('produces a circle when amplitude is 0', () => {
    const cx = 100;
    const cy = 100;
    const r = 50;
    const path = generateDeformedRingPath(cx, cy, r, 0, 3, 0, 36);

    // Extract all coordinate pairs
    const coords = [...path.matchAll(/([\d.-]+),([\d.-]+)/g)].map(
      (m) => [parseFloat(m[1]), parseFloat(m[2])] as const,
    );

    // Every point should be at distance r from centre
    for (const [x, y] of coords) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      expect(dist).toBeCloseTo(r, 1);
    }
  });

  it('produces a deformed ring when amplitude > 0', () => {
    const cx = 100;
    const cy = 100;
    const r = 50;
    const amplitude = 10;
    const path = generateDeformedRingPath(cx, cy, r, amplitude, 3, 0, 36);

    const coords = [...path.matchAll(/([\d.-]+),([\d.-]+)/g)].map(
      (m) => [parseFloat(m[1]), parseFloat(m[2])] as const,
    );

    const distances = coords.map(([x, y]) =>
      Math.sqrt((x - cx) ** 2 + (y - cy) ** 2),
    );
    const minDist = Math.min(...distances);
    const maxDist = Math.max(...distances);

    // Range should span roughly 2 * amplitude
    expect(maxDist - minDist).toBeGreaterThan(amplitude);
    expect(maxDist).toBeLessThanOrEqual(r + amplitude + 0.01);
    expect(minDist).toBeGreaterThanOrEqual(r - amplitude - 0.01);
  });

  it('generates the expected number of segments', () => {
    const segments = 24;
    const path = generateDeformedRingPath(0, 0, 10, 0, 3, 0, segments);

    // segments + 1 points (first = M, rest = L) then Z
    const moveCount = (path.match(/M/g) ?? []).length;
    const lineCount = (path.match(/L/g) ?? []).length;

    expect(moveCount).toBe(1);
    expect(lineCount).toBe(segments);
  });
});

// =====================================================================
// identityColor
// =====================================================================

describe('identityColor', () => {
  it('returns an hsla string with 1 decimal precision', () => {
    const result = identityColor(180, 75, 50);

    expect(result).toBe('hsla(180.0, 75.0%, 50.0%, 1)');
  });

  it('includes alpha when specified', () => {
    const result = identityColor(45, 90, 55, 0.5);

    expect(result).toBe('hsla(45.0, 90.0%, 55.0%, 0.5)');
  });

  it('defaults alpha to 1', () => {
    const result = identityColor(0, 0, 0);

    expect(result).toContain('1)');
  });
});

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
