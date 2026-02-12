import {
  deriveIdentityParams,
  generateDeformedRingPath,
  identityColor,
  type IdentityParams,
} from './agent-identity-params.js';

export interface AgentIdentityMarkProps {
  /** Ed25519 public key (with or without `ed25519:` prefix). */
  publicKey: string;
  /** Rendered height/width in pixels. @default 40 */
  size?: number;
  /** Pre-derived params to avoid redundant computation. */
  params?: IdentityParams;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Compact identity glyph (24–64 px).
 *
 * Static concentric deformed rings with a breathing core.
 * Designed for inline use next to agent names, in lists, and
 * anywhere a recognisable-at-a-glance avatar is needed.
 */
export function AgentIdentityMark({
  publicKey,
  size = 40,
  params: external,
  className,
  style,
}: AgentIdentityMarkProps) {
  const p = external ?? deriveIdentityParams(publicKey);
  const {
    rings,
    glowIntensity,
    coreHue,
    coreSaturation,
    coreLightness,
    idPrefix,
    pulseRate,
  } = p;

  const VB = 100;
  const cx = VB / 2;
  const cy = VB / 2;
  const maxR = VB / 2 - 5;

  // Scale deformation down at tiny sizes so paths stay legible.
  const deformScale = Math.min(1, size / 64);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${VB} ${VB}`}
      width={size}
      height={size}
      className={className}
      style={style}
      role="img"
      aria-label="Agent identity mark"
    >
      <defs>
        <filter
          id={`${idPrefix}-mg`}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
        >
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <filter
          id={`${idPrefix}-mcg`}
          x="-100%"
          y="-100%"
          width="300%"
          height="300%"
        >
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* Core ambient glow — breathing */}
      <circle
        cx={cx}
        cy={cy}
        r={maxR * 0.2}
        fill={identityColor(coreHue, coreSaturation, coreLightness)}
        opacity={glowIntensity * 0.5}
        filter={`url(#${idPrefix}-mcg)`}
      >
        <animate
          attributeName="opacity"
          values={`${(glowIntensity * 0.35).toFixed(3)};${(glowIntensity * 0.65).toFixed(3)};${(glowIntensity * 0.35).toFixed(3)}`}
          dur={`${pulseRate}s`}
          repeatCount="indefinite"
        />
      </circle>

      {/* Rings — inner to outer */}
      {rings.map((ring, i) => {
        const radius = maxR * ring.radiusFraction;
        const amp = ring.deformAmplitude * deformScale;
        const d = generateDeformedRingPath(
          cx,
          cy,
          radius,
          amp,
          ring.deformFrequency,
          ring.deformPhase,
          48,
        );
        const color = identityColor(ring.hue, ring.saturation, ring.lightness);
        const glow = identityColor(
          ring.hue,
          ring.saturation,
          ring.lightness,
          0.4,
        );

        return (
          <g key={i}>
            {/* Soft glow behind stroke */}
            <path
              d={d}
              fill="none"
              stroke={glow}
              strokeWidth={ring.strokeWidth * 2.5}
              filter={`url(#${idPrefix}-mg)`}
              opacity={glowIntensity * 0.4}
            />
            {/* Crisp ring */}
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={ring.strokeWidth * 0.6}
              strokeLinecap="round"
              opacity={0.65 + (i / rings.length) * 0.35}
            />
          </g>
        );
      })}

      {/* Core dot — breathing */}
      <circle
        cx={cx}
        cy={cy}
        r={maxR * 0.07}
        fill={identityColor(coreHue, coreSaturation, coreLightness + 15)}
      >
        <animate
          attributeName="r"
          values={`${(maxR * 0.06).toFixed(2)};${(maxR * 0.09).toFixed(2)};${(maxR * 0.06).toFixed(2)}`}
          dur={`${pulseRate}s`}
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}
