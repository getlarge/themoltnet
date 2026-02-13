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
  /** Core amber-spectrum hue */
  coreHue: number;
  coreSaturation: number;
  coreLightness: number;
  /** Short hex prefix for scoping SVG filter IDs */
  idPrefix: string;
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
  const baseRingHue = norm(bytes[1], 150, 210); // teal–cyan spectrum
  const coreHue = norm(bytes[2], 30, 58); // amber–gold spectrum
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

  return {
    rings,
    pulseRate,
    glowIntensity,
    coreHue,
    coreSaturation: norm(bytes[2], 80, 100),
    coreLightness: norm(bytes[3], 45, 55),
    idPrefix,
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
