/**
 * Deterministic visual parameter derivation from Ed25519 public keys.
 *
 * Each agent's 32-byte public key is decoded and its raw bytes are used
 * to seed every visual parameter — ring count, hues, stroke widths,
 * rotation speeds, sinusoidal deformations, pulse rate, and glow intensity.
 * The result is a unique, reproducible visual fingerprint per agent.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdentityRing {
  /** HSL hue (0–360) */
  hue: number;
  /** HSL saturation (0–100) */
  saturation: number;
  /** HSL lightness (0–100) */
  lightness: number;
  /** Stroke width in viewBox units */
  strokeWidth: number;
  /** Full-rotation period in seconds */
  rotationDuration: number;
  /** Rotation direction */
  rotationDirection: 'cw' | 'ccw';
  /** Sinusoidal radial displacement amplitude */
  deformAmplitude: number;
  /** Number of sinusoidal lobes (2–7) */
  deformFrequency: number;
  /** Phase offset in radians (0–2π) */
  deformPhase: number;
  /** Normalised distance from centre (0–1) */
  radiusFraction: number;
}

export interface IdentityParams {
  rings: IdentityRing[];
  /** Breathing pulse period in seconds */
  pulseRate: number;
  /** Overall glow strength (0–1) */
  glowIntensity: number;
  /** Core hue (complementary to ring hue) */
  coreHue: number;
  coreSaturation: number;
  coreLightness: number;
  /** Short hex prefix for scoping SVG filter IDs */
  idPrefix: string;
  /** Visibility-safe hex accent color derived from the key's base hue */
  accentHex: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodeBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Normalise a byte (0–255) into `[lo, hi]`. */
function norm(byte: number, lo: number, hi: number): number {
  return lo + (byte / 255) * (hi - lo);
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

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export function deriveIdentityParams(publicKey: string): IdentityParams {
  const keyStr = publicKey.replace(/^ed25519:/, '');
  const bytes = decodeBase64(keyStr);

  const idPrefix = `mid-${Array.from(bytes.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;

  // Global params from first five bytes
  const ringCount = 3 + (bytes[0] % 4); // 3–6
  const baseRingHue = norm(bytes[1], 0, 360); // full spectrum — each agent gets a unique hue
  const coreHueOffset = norm(bytes[2], 120, 240); // complementary offset from ring hue
  const coreHue = (baseRingHue + coreHueOffset) % 360;
  const pulseRate = norm(bytes[3], 2.5, 5.5);
  const glowIntensity = norm(bytes[4], 0.15, 0.45);

  const rings: IdentityRing[] = [];

  for (let i = 0; i < ringCount; i++) {
    const off = 5 + i * 4;
    const b0 = bytes[off % 32];
    const b1 = bytes[(off + 1) % 32];
    const b2 = bytes[(off + 2) % 32];
    const b3 = bytes[(off + 3) % 32];

    const t = ringCount > 1 ? i / (ringCount - 1) : 0.5;

    const hueShift = (b0 / 255 - 0.5) * 30;
    const hue = (((baseRingHue + hueShift) % 360) + 360) % 360;
    const saturation = norm(b1, 65, 100);
    const lightness = norm(b1, 38, 56);
    const strokeWidth = 1.5 + t * 2.5 + norm(b2, 0, 1);
    const rotationDuration = 14 + t * 12 + norm(b2, 0, 14);
    const rotationDirection: 'cw' | 'ccw' =
      (i + (b3 > 128 ? 1 : 0)) % 2 === 0 ? 'cw' : 'ccw';
    const deformAmplitude = (b3 / 255) * (3 + t * 4);
    const deformFrequency = 2 + (b0 % 6);
    const deformPhase = (b1 / 255) * Math.PI * 2;
    const radiusFraction = 0.3 + t * 0.62;

    rings.push({
      hue,
      saturation,
      lightness,
      strokeWidth,
      rotationDuration,
      rotationDirection,
      deformAmplitude,
      deformFrequency,
      deformPhase,
      radiusFraction,
    });
  }

  // Accent hex: base ring hue at vibrant saturation/lightness for UI use
  const [aR, aG, aB] = hslToRgb(baseRingHue, 75, 50);
  const accentHex = rgbToHex(aR, aG, aB);

  return {
    rings,
    pulseRate,
    glowIntensity,
    coreHue,
    coreSaturation: norm(bytes[2], 80, 100),
    coreLightness: norm(bytes[3], 45, 55),
    idPrefix,
    accentHex,
  };
}

// ---------------------------------------------------------------------------
// Path generation
// ---------------------------------------------------------------------------

/**
 * Build an SVG `d` attribute for a closed ring whose radius is
 * perturbed by `amplitude * sin(frequency * θ + phase)`.
 */
export function generateDeformedRingPath(
  cx: number,
  cy: number,
  radius: number,
  amplitude: number,
  frequency: number,
  phase: number,
  segments = 72,
): string {
  const parts: string[] = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const r = radius + amplitude * Math.sin(frequency * theta + phase);
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    parts.push(
      i === 0
        ? `M${x.toFixed(2)},${y.toFixed(2)}`
        : `L${x.toFixed(2)},${y.toFixed(2)}`,
    );
  }
  return parts.join(' ') + ' Z';
}

// ---------------------------------------------------------------------------
// Colour helper
// ---------------------------------------------------------------------------

export function identityColor(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, ${a})`;
}

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

/**
 * Derive a unique, visibility-safe hex color from a fingerprint string.
 *
 * Takes the first 6 hex characters (after stripping dashes), converts to
 * HSL, clamps saturation to [30, 100] and lightness to [35, 65], then
 * converts back.
 */
export function deriveFingerprintColor(fingerprint: string): FingerprintColor {
  const hex6 = fingerprint.replace(/-/g, '').slice(0, 6).toUpperCase();
  const r = parseInt(hex6.slice(0, 2), 16) || 0;
  const g = parseInt(hex6.slice(2, 4), 16) || 0;
  const b = parseInt(hex6.slice(4, 6), 16) || 0;

  const raw = rgbToHex(r, g, b);
  const [h, s, l] = rgbToHsl(r, g, b);

  const clampedS = Math.max(30, Math.min(100, s));
  const clampedL = Math.max(35, Math.min(65, l));

  const [ar, ag, ab] = hslToRgb(h, clampedS, clampedL);
  const hex = rgbToHex(ar, ag, ab);

  return { raw, hex, hsl: [h, clampedS, clampedL] };
}
