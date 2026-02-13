import {
  deriveIdentityParams,
  generateDeformedRingPath,
  identityColor,
  type IdentityParams,
  type IdentityRing,
} from './agent-identity-params.js';

export interface AgentIdentityFullProps {
  /** Ed25519 public key (with or without `ed25519:` prefix). */
  publicKey: string;
  /** Rendered height/width in pixels. @default 300 */
  size?: number;
  /** Pre-derived params to skip redundant derivation. */
  params?: IdentityParams;
  /** Play the staggered entrance sequence. @default true */
  animated?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Full-size agent identity visualisation (200–400 px).
 *
 * Choreographed reveal:
 *  1. Ambient radiance fades in
 *  2. Deformed rings enter one-by-one, each rotating
 *  3. Core diamond materialises with elastic bounce
 *  4. Orbital particles begin tracing
 *  5. Halo breathes continuously
 *
 * Every visual parameter is derived from the agent's Ed25519 public key
 * so no two agents look alike.
 */
export function AgentIdentityFull({
  publicKey,
  size = 300,
  params: external,
  animated = true,
  className,
  style,
}: AgentIdentityFullProps) {
  const p = external ?? deriveIdentityParams(publicKey);
  const {
    rings,
    pulseRate,
    glowIntensity,
    coreHue,
    coreSaturation,
    coreLightness,
    idPrefix,
  } = p;

  const VB = 400;
  const cx = VB / 2;
  const cy = VB / 2;
  const maxR = VB / 2 - 20;

  // Timing helpers
  const ringEnter = (i: number) => (animated ? 0.4 + i * 0.3 : 0);
  const coreDelay = animated ? 0.4 + rings.length * 0.3 : 0;
  const particleDelay = animated ? 1 + rings.length * 0.3 : 0;
  const haloDelay = animated ? 1.5 + rings.length * 0.3 : 0;

  const gi = glowIntensity; // shorthand

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${VB} ${VB}`}
      width={size}
      height={size}
      className={className}
      style={style}
      role="img"
      aria-label="Agent identity visualisation"
    >
      {/* ──── Filters ──── */}
      <defs>
        <filter
          id={`${idPrefix}-fw`}
          x="-80%"
          y="-80%"
          width="260%"
          height="260%"
        >
          <feGaussianBlur stdDeviation="16" />
        </filter>
        <filter
          id={`${idPrefix}-fr`}
          x="-40%"
          y="-40%"
          width="180%"
          height="180%"
        >
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter
          id={`${idPrefix}-fc`}
          x="-100%"
          y="-100%"
          width="300%"
          height="300%"
        >
          <feGaussianBlur stdDeviation="12" />
        </filter>
        <filter
          id={`${idPrefix}-fct`}
          x="-60%"
          y="-60%"
          width="220%"
          height="220%"
        >
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter
          id={`${idPrefix}-fp`}
          x="-200%"
          y="-200%"
          width="500%"
          height="500%"
        >
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter
          id={`${idPrefix}-ff`}
          x="-150%"
          y="-150%"
          width="400%"
          height="400%"
        >
          <feGaussianBlur stdDeviation="24" />
        </filter>
      </defs>

      {/* ──── 1 · Ambient radiance ──── */}
      <circle
        cx={cx}
        cy={cy}
        r={maxR * 0.55}
        fill={identityColor(coreHue, coreSaturation, coreLightness)}
        opacity="0"
        filter={`url(#${idPrefix}-fw)`}
      >
        <animate
          attributeName="opacity"
          values={`0;${(gi * 0.08).toFixed(3)}`}
          dur="1.2s"
          begin={animated ? '0.2s' : '0s'}
          fill="freeze"
          id={`${idPrefix}-amb-in`}
        />
        <animate
          attributeName="opacity"
          values={`${(gi * 0.06).toFixed(3)};${(gi * 0.12).toFixed(3)};${(gi * 0.06).toFixed(3)}`}
          dur={`${pulseRate}s`}
          begin={`${idPrefix}-amb-in.end`}
          repeatCount="indefinite"
        />
      </circle>

      {/* ──── 2 · Rotating deformed rings ──── */}
      {rings.map((ring, i) => {
        const radius = maxR * ring.radiusFraction;
        const d = generateDeformedRingPath(
          cx,
          cy,
          radius,
          ring.deformAmplitude,
          ring.deformFrequency,
          ring.deformPhase,
          72,
        );
        const color = identityColor(ring.hue, ring.saturation, ring.lightness);
        const glow = identityColor(
          ring.hue,
          ring.saturation,
          ring.lightness,
          0.5,
        );
        const dir = ring.rotationDirection === 'ccw' ? -360 : 360;
        const enter = ringEnter(i);
        const finalOpacity = 0.55 + (i / rings.length) * 0.45;

        return (
          <g key={i}>
            {/* Glow layer (rotates with ring) */}
            <g opacity="0">
              <path
                d={d}
                fill="none"
                stroke={glow}
                strokeWidth={ring.strokeWidth * 3}
                filter={`url(#${idPrefix}-fr)`}
                opacity={gi * 0.55}
              />
              <animate
                attributeName="opacity"
                values="0;1"
                dur="0.6s"
                begin={`${enter}s`}
                fill="freeze"
              />
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`0 ${cx} ${cy}`}
                to={`${dir} ${cx} ${cy}`}
                dur={`${ring.rotationDuration}s`}
                repeatCount="indefinite"
              />
            </g>

            {/* Crisp stroke (rotates with ring) */}
            <g opacity="0">
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={ring.strokeWidth}
                strokeLinecap="round"
              />
              <animate
                attributeName="opacity"
                values={`0;${finalOpacity.toFixed(2)}`}
                dur="0.5s"
                begin={`${enter}s`}
                fill="freeze"
              />
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`0 ${cx} ${cy}`}
                to={`${dir} ${cx} ${cy}`}
                dur={`${ring.rotationDuration}s`}
                repeatCount="indefinite"
              />
            </g>
          </g>
        );
      })}

      {/* ──── 3 · Core identity ──── */}

      {/* Wide core glow — breathing */}
      <circle
        cx={cx}
        cy={cy}
        r={maxR * 0.12}
        fill={identityColor(coreHue, coreSaturation, coreLightness)}
        opacity="0"
        filter={`url(#${idPrefix}-fc)`}
      >
        <animate
          attributeName="opacity"
          values={`0;${(gi * 0.5).toFixed(2)}`}
          dur="0.5s"
          begin={`${coreDelay}s`}
          fill="freeze"
          id={`${idPrefix}-ci`}
        />
        <animate
          attributeName="opacity"
          values={`${(gi * 0.3).toFixed(2)};${(gi * 0.6).toFixed(2)};${(gi * 0.3).toFixed(2)}`}
          dur={`${pulseRate}s`}
          begin={`${idPrefix}-ci.end`}
          repeatCount="indefinite"
        />
      </circle>

      {/* Tight core glow — breathing */}
      <circle
        cx={cx}
        cy={cy}
        r={maxR * 0.06}
        fill={identityColor(coreHue, coreSaturation, coreLightness + 10)}
        opacity="0"
        filter={`url(#${idPrefix}-fct)`}
      >
        <animate
          attributeName="opacity"
          values={`0;${(gi * 0.8).toFixed(2)}`}
          dur="0.4s"
          begin={`${coreDelay + 0.1}s`}
          fill="freeze"
          id={`${idPrefix}-cti`}
        />
        <animate
          attributeName="opacity"
          values={`${(gi * 0.5).toFixed(2)};${(gi * 0.9).toFixed(2)};${(gi * 0.5).toFixed(2)}`}
          dur={`${pulseRate}s`}
          begin={`${idPrefix}-cti.end`}
          repeatCount="indefinite"
        />
      </circle>

      {/* Diamond flash — single bright pulse on materialisation */}
      <DiamondShape cx={cx} cy={cy} r={maxR * 0.05}>
        {(points) => (
          <polygon
            points={points}
            fill={identityColor(coreHue, coreSaturation, coreLightness + 20)}
            opacity="0"
            filter={`url(#${idPrefix}-ff)`}
          >
            <animate
              attributeName="opacity"
              values="0;0.6;0"
              dur="0.7s"
              begin={`${coreDelay}s`}
              fill="freeze"
            />
          </polygon>
        )}
      </DiamondShape>

      {/* Faceted core diamond — elastic bounce in */}
      <g style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <DiamondShape cx={cx} cy={cy} r={maxR * 0.04}>
          {(points) => (
            <g opacity="0">
              <polygon
                points={points}
                fill={identityColor(
                  coreHue,
                  coreSaturation,
                  coreLightness + 18,
                )}
              />
              <polygon
                points={points}
                fill="none"
                stroke={identityColor(
                  coreHue,
                  coreSaturation,
                  coreLightness + 28,
                  0.45,
                )}
                strokeWidth="0.5"
                strokeLinejoin="miter"
              />
              <animate
                attributeName="opacity"
                values="0;1"
                dur="0.3s"
                begin={`${coreDelay}s`}
                fill="freeze"
              />
            </g>
          )}
        </DiamondShape>
        <animateTransform
          attributeName="transform"
          type="scale"
          values="0;1.2;0.92;1.03;1"
          dur="0.7s"
          begin={`${coreDelay}s`}
          fill="freeze"
          calcMode="spline"
          keySplines="0.34 1.56 0.64 1; 0.25 0.1 0.25 1; 0.42 0 0.58 1; 0.25 0.1 0.25 1"
        />
      </g>

      {/* ──── 4 · Orbital particles ──── */}
      {rings.length > 0 && (
        <OrbitalParticles
          cx={cx}
          cy={cy}
          rings={rings}
          maxR={maxR}
          coreHue={coreHue}
          coreSaturation={coreSaturation}
          coreLightness={coreLightness}
          idPrefix={idPrefix}
          delay={particleDelay}
        />
      )}

      {/* ──── 5 · Ambient halo ──── */}
      {rings.length > 0 &&
        (() => {
          const outer = rings[rings.length - 1];
          const haloR = maxR * outer.radiusFraction + 10;
          const haloCol = identityColor(
            outer.hue,
            outer.saturation,
            outer.lightness,
          );

          return (
            <circle
              cx={cx}
              cy={cy}
              r={haloR}
              fill="none"
              stroke={haloCol}
              strokeWidth="0.5"
              opacity="0"
            >
              <animate
                attributeName="opacity"
                values={`0;${(gi * 0.25).toFixed(2)};${(gi * 0.08).toFixed(2)};${(gi * 0.25).toFixed(2)}`}
                dur={`${pulseRate * 1.2}s`}
                begin={`${haloDelay}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="r"
                values={`${haloR.toFixed(1)};${(haloR + 4).toFixed(1)};${haloR.toFixed(1)}`}
                dur={`${pulseRate * 1.2}s`}
                begin={`${haloDelay}s`}
                repeatCount="indefinite"
              />
            </circle>
          );
        })()}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Internal helpers (kept private — no export)
// ---------------------------------------------------------------------------

/**
 * Render-prop helper that computes diamond `points` once.
 */
function DiamondShape({
  cx,
  cy,
  r,
  children,
}: {
  cx: number;
  cy: number;
  r: number;
  children: (points: string) => React.ReactNode;
}) {
  const pts = `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
  return <>{children(pts)}</>;
}

function OrbitalParticles({
  cx,
  cy,
  rings,
  maxR,
  coreHue,
  coreSaturation,
  coreLightness,
  idPrefix,
  delay,
}: {
  cx: number;
  cy: number;
  rings: readonly IdentityRing[];
  maxR: number;
  coreHue: number;
  coreSaturation: number;
  coreLightness: number;
  idPrefix: string;
  delay: number;
}) {
  const outer = rings[rings.length - 1];
  const orbitR = maxR * outer.radiusFraction;
  const ringParticle = identityColor(
    outer.hue,
    outer.saturation,
    outer.lightness + 10,
  );
  const coreParticle = identityColor(
    coreHue,
    coreSaturation,
    coreLightness + 15,
  );

  return (
    <>
      <circle
        id={`${idPrefix}-orb`}
        cx={cx}
        cy={cy}
        r={orbitR}
        fill="none"
        stroke="none"
      />

      {/* Fast ring-hue particle */}
      <circle
        r="3"
        fill={ringParticle}
        opacity="0"
        filter={`url(#${idPrefix}-fp)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.6;0.6;0"
          keyTimes="0;0.05;0.85;1"
          dur={`${outer.rotationDuration * 0.55}s`}
          begin={`${delay}s`}
          repeatCount="indefinite"
        />
        <animateMotion
          dur={`${outer.rotationDuration * 0.55}s`}
          begin={`${delay}s`}
          repeatCount="indefinite"
          rotate="auto"
        >
          <mpath href={`#${idPrefix}-orb`} />
        </animateMotion>
      </circle>

      {/* Slow core-hue particle */}
      <circle
        r="2"
        fill={coreParticle}
        opacity="0"
        filter={`url(#${idPrefix}-fp)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.4;0.4;0"
          keyTimes="0;0.05;0.85;1"
          dur={`${outer.rotationDuration * 0.75}s`}
          begin={`${delay + 1.8}s`}
          repeatCount="indefinite"
        />
        <animateMotion
          dur={`${outer.rotationDuration * 0.75}s`}
          begin={`${delay + 1.8}s`}
          repeatCount="indefinite"
          rotate="auto"
        >
          <mpath href={`#${idPrefix}-orb`} />
        </animateMotion>
      </circle>
    </>
  );
}
