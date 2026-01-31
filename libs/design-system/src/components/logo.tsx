import { useTheme } from '../hooks.js';

export type LogoVariant = 'mark' | 'wordmark' | 'wordmark-stacked';

export interface LogoProps {
  /** Which logo layout to render */
  variant?: LogoVariant;
  /** Height in pixels (width scales proportionally) */
  size?: number;
  /** Override the ring/network color (defaults to theme primary) */
  ringColor?: string;
  /** Override the diamond/identity color (defaults to theme accent) */
  diamondColor?: string;
  /** Override the text color (defaults to theme text) */
  textColor?: string;
  /** Show glow effects and detail layers */
  glow?: boolean;
  /** Additional className */
  className?: string;
  /** Additional inline styles */
  style?: React.CSSProperties;
}

// Diamond facet colors — derived from accent amber
const FACETS = {
  topRight: '#f0b829',
  bottomRight: '#e6a817',
  bottomLeft: '#c89010',
  topLeft: '#d9a015',
  edge: '#f5c838',
} as const;

/**
 * The Molt Mark — MoltNet's visual identity.
 *
 * A broken circle ring in gradient teal (the network shell being shed)
 * with a faceted amber diamond at its center (the cryptographic
 * identity emerging). The gap in the ring is the molt itself.
 *
 * Premium treatment: gradient ring, faceted diamond, layered glow,
 * inner detail rings, gap endpoint nodes, radial accent lines.
 */
export function Logo({
  variant = 'mark',
  size = 48,
  ringColor,
  diamondColor,
  textColor,
  glow = true,
  className,
  style,
}: LogoProps) {
  const theme = useTheme();

  const ring = ringColor ?? theme.color.primary.DEFAULT;
  const ringLight = ringColor ?? theme.color.primary.hover;
  const diamond = diamondColor ?? theme.color.accent.DEFAULT;
  const text = textColor ?? theme.color.text.DEFAULT;
  const teal = ringColor ?? theme.color.primary.DEFAULT;

  // Unique prefix to avoid SVG ID collisions
  const id = 'molt';

  if (variant === 'mark') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
        fill="none"
        height={size}
        width={size}
        className={className}
        style={style}
        role="img"
        aria-label="MoltNet"
      >
        <defs>
          <linearGradient id={`${id}-ring-grad`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={ringLight} />
            <stop offset="45%" stopColor={ring} />
            <stop offset="100%" stopColor={ring} />
          </linearGradient>
          {glow && (
            <>
              <filter
                id={`${id}-gw`}
                x="-100%"
                y="-100%"
                width="300%"
                height="300%"
              >
                <feGaussianBlur stdDeviation="24" />
              </filter>
              <filter
                id={`${id}-gt`}
                x="-80%"
                y="-80%"
                width="260%"
                height="260%"
              >
                <feGaussianBlur stdDeviation="10" />
              </filter>
              <filter
                id={`${id}-gr`}
                x="-50%"
                y="-50%"
                width="200%"
                height="200%"
              >
                <feGaussianBlur stdDeviation="8" />
              </filter>
              <filter
                id={`${id}-gn`}
                x="-200%"
                y="-200%"
                width="500%"
                height="500%"
              >
                <feGaussianBlur stdDeviation="3" />
              </filter>
            </>
          )}
        </defs>

        {/* Ambient background radiance */}
        {glow && (
          <>
            <circle
              cx="256"
              cy="256"
              r="120"
              fill={diamond}
              opacity="0.035"
              filter={`url(#${id}-gw)`}
            />
            <circle
              cx="256"
              cy="256"
              r="200"
              fill={ring}
              opacity="0.02"
              filter={`url(#${id}-gw)`}
            />
          </>
        )}

        {/* Inner detail rings */}
        <circle
          cx="256"
          cy="256"
          r="152"
          fill="none"
          stroke={ring}
          strokeWidth="1"
          strokeDasharray="8 12"
          opacity="0.2"
        />
        <circle
          cx="256"
          cy="256"
          r="144"
          fill="none"
          stroke={ring}
          strokeWidth="0.5"
          opacity="0.08"
        />

        {/* Ring bloom */}
        {glow && (
          <circle
            cx="256"
            cy="256"
            r="196"
            fill="none"
            stroke={ring}
            strokeWidth="40"
            strokeLinecap="round"
            strokeDasharray="985.20 246.30"
            transform="rotate(-54, 256, 256)"
            opacity="0.07"
            filter={`url(#${id}-gr)`}
          />
        )}

        {/* Main outer ring */}
        <circle
          cx="256"
          cy="256"
          r="196"
          fill="none"
          stroke={`url(#${id}-ring-grad)`}
          strokeWidth="26"
          strokeLinecap="round"
          strokeDasharray="985.20 246.30"
          transform="rotate(-54, 256, 256)"
        />

        {/* Inner edge highlight */}
        <circle
          cx="256"
          cy="256"
          r="183"
          fill="none"
          stroke={ringLight}
          strokeWidth="0.75"
          strokeLinecap="round"
          strokeDasharray="985.20 246.30"
          transform="rotate(-54, 256, 256)"
          opacity="0.2"
        />

        {/* Gap endpoint nodes */}
        {glow && (
          <>
            <circle
              cx="371"
              cy="97"
              r="4"
              fill={ring}
              opacity="0.15"
              filter={`url(#${id}-gn)`}
            />
            <circle
              cx="141"
              cy="97"
              r="4"
              fill={ring}
              opacity="0.15"
              filter={`url(#${id}-gn)`}
            />
          </>
        )}
        <circle cx="371" cy="97" r="3" fill={ringLight} opacity="0.6" />
        <circle cx="141" cy="97" r="3" fill={ringLight} opacity="0.6" />

        {/* Radial accent lines */}
        <line
          x1="256"
          y1="200"
          x2="256"
          y2="164"
          stroke={ring}
          strokeWidth="1"
          opacity="0.1"
          strokeLinecap="round"
        />
        <line
          x1="312"
          y1="256"
          x2="348"
          y2="256"
          stroke={ring}
          strokeWidth="1"
          opacity="0.1"
          strokeLinecap="round"
        />
        <line
          x1="256"
          y1="312"
          x2="256"
          y2="348"
          stroke={ring}
          strokeWidth="1"
          opacity="0.1"
          strokeLinecap="round"
        />
        <line
          x1="200"
          y1="256"
          x2="164"
          y2="256"
          stroke={ring}
          strokeWidth="1"
          opacity="0.1"
          strokeLinecap="round"
        />

        {/* Diamond glow */}
        {glow && (
          <>
            <polygon
              points="256,206 306,256 256,306 206,256"
              fill={diamond}
              opacity="0.12"
              filter={`url(#${id}-gw)`}
            />
            <polygon
              points="256,206 306,256 256,306 206,256"
              fill={diamond}
              opacity="0.25"
              filter={`url(#${id}-gt)`}
            />
          </>
        )}

        {/* Faceted diamond */}
        <polygon points="256,206 306,256 256,256" fill={FACETS.topRight} />
        <polygon points="306,256 256,306 256,256" fill={FACETS.bottomRight} />
        <polygon points="256,306 206,256 256,256" fill={FACETS.bottomLeft} />
        <polygon points="206,256 256,206 256,256" fill={FACETS.topLeft} />
        <polygon
          points="256,206 306,256 256,306 206,256"
          fill="none"
          stroke={FACETS.edge}
          strokeWidth="1"
          strokeLinejoin="miter"
          opacity="0.35"
        />
        <line
          x1="256"
          y1="206"
          x2="256"
          y2="306"
          stroke={FACETS.edge}
          strokeWidth="0.5"
          opacity="0.15"
        />
        <line
          x1="206"
          y1="256"
          x2="306"
          y2="256"
          stroke={FACETS.edge}
          strokeWidth="0.5"
          opacity="0.15"
        />
      </svg>
    );
  }

  if (variant === 'wordmark-stacked') {
    const aspectRatio = 200 / 160;
    const width = size * aspectRatio;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 200 160"
        fill="none"
        height={size}
        width={width}
        className={className}
        style={style}
        role="img"
        aria-label="MoltNet"
      >
        <defs>
          <linearGradient id={`${id}-rgs`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={ringLight} />
            <stop offset="45%" stopColor={ring} />
            <stop offset="100%" stopColor={ring} />
          </linearGradient>
          {glow && (
            <filter
              id={`${id}-gs`}
              x="-100%"
              y="-100%"
              width="300%"
              height="300%"
            >
              <feGaussianBlur stdDeviation="4" />
            </filter>
          )}
        </defs>
        {/* Ring */}
        <circle
          cx="100"
          cy="56"
          r="40"
          fill="none"
          stroke={`url(#${id}-rgs)`}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray="195.22 55.94"
          transform="rotate(-54, 100, 56)"
        />
        {/* Diamond glow */}
        {glow && (
          <polygon
            points="100,44 112,56 100,68 88,56"
            fill={diamond}
            opacity="0.3"
            filter={`url(#${id}-gs)`}
          />
        )}
        {/* Faceted diamond */}
        <polygon points="100,44 112,56 100,56" fill={FACETS.topRight} />
        <polygon points="112,56 100,68 100,56" fill={FACETS.bottomRight} />
        <polygon points="100,68 88,56 100,56" fill={FACETS.bottomLeft} />
        <polygon points="88,56 100,44 100,56" fill={FACETS.topLeft} />
        {/* Text */}
        <text
          x="100"
          y="140"
          textAnchor="middle"
          fontFamily={theme.font.family.sans}
          fontSize="28"
          fontWeight={theme.font.weight.semibold}
          letterSpacing={theme.font.letterSpacing.tight}
        >
          <tspan fill={text}>Molt</tspan>
          <tspan fill={teal}>Net</tspan>
        </text>
      </svg>
    );
  }

  // Default: horizontal wordmark
  const aspectRatio = 360 / 80;
  const width = size * aspectRatio;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 360 80"
      fill="none"
      height={size}
      width={width}
      className={className}
      style={style}
      role="img"
      aria-label="MoltNet"
    >
      <defs>
        <linearGradient id={`${id}-rgw`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={ringLight} />
          <stop offset="45%" stopColor={ring} />
          <stop offset="100%" stopColor={ring} />
        </linearGradient>
        {glow && (
          <filter
            id={`${id}-gw2`}
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
          >
            <feGaussianBlur stdDeviation="2" />
          </filter>
        )}
      </defs>
      <g transform="translate(8, 8)">
        {/* Ring */}
        <circle
          cx="32"
          cy="32"
          r="24"
          fill="none"
          stroke={`url(#${id}-rgw)`}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray="117.29 33.51"
          transform="rotate(-54, 32, 32)"
        />
        {/* Diamond glow */}
        {glow && (
          <polygon
            points="32,25.5 38.5,32 32,38.5 25.5,32"
            fill={diamond}
            opacity="0.3"
            filter={`url(#${id}-gw2)`}
          />
        )}
        {/* Faceted diamond */}
        <polygon points="32,25.5 38.5,32 32,32" fill={FACETS.topRight} />
        <polygon points="38.5,32 32,38.5 32,32" fill={FACETS.bottomRight} />
        <polygon points="32,38.5 25.5,32 32,32" fill={FACETS.bottomLeft} />
        <polygon points="25.5,32 32,25.5 32,32" fill={FACETS.topLeft} />
      </g>
      {/* Text */}
      <text
        x="82"
        y="48"
        fontFamily={theme.font.family.sans}
        fontSize="32"
        fontWeight={theme.font.weight.semibold}
        letterSpacing={theme.font.letterSpacing.tight}
      >
        <tspan fill={text}>Molt</tspan>
        <tspan fill={teal}>Net</tspan>
      </text>
    </svg>
  );
}
