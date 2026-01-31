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
  /** Show the amber glow behind the diamond */
  glow?: boolean;
  /** Additional className */
  className?: string;
  /** Additional inline styles */
  style?: React.CSSProperties;
}

/**
 * The Molt Mark — MoltNet's visual identity.
 *
 * A broken circle ring in teal (the network shell being shed)
 * with a solid amber diamond at its center (the cryptographic
 * identity emerging). The gap in the ring is the molt itself.
 *
 * "The keypair is the tattoo. Ed25519. 32 bytes that say: this is me."
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
  const diamond = diamondColor ?? theme.color.accent.DEFAULT;
  const text = textColor ?? theme.color.text.DEFAULT;
  const teal = ringColor ?? theme.color.primary.DEFAULT;

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
        {glow && (
          <defs>
            <filter
              id="molt-glow"
              x="-100%"
              y="-100%"
              width="300%"
              height="300%"
            >
              <feGaussianBlur stdDeviation="16" />
            </filter>
          </defs>
        )}
        <circle
          cx="256"
          cy="256"
          r="192"
          fill="none"
          stroke={ring}
          strokeWidth="32"
          strokeLinecap="round"
          strokeDasharray="938.29 268.08"
          transform="rotate(-50, 256, 256)"
        />
        {glow && (
          <polygon
            points="256,200 312,256 256,312 200,256"
            fill={diamond}
            opacity="0.25"
            filter="url(#molt-glow)"
          />
        )}
        <polygon points="256,200 312,256 256,312 200,256" fill={diamond} />
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
        {glow && (
          <defs>
            <filter
              id="molt-glow-s"
              x="-100%"
              y="-100%"
              width="300%"
              height="300%"
            >
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>
        )}
        <circle
          cx="100"
          cy="56"
          r="48"
          fill="none"
          stroke={ring}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray="234.57 67.02"
          transform="rotate(-50, 100, 56)"
        />
        {glow && (
          <polygon
            points="100,42 114,56 100,70 86,56"
            fill={diamond}
            opacity="0.3"
            filter="url(#molt-glow-s)"
          />
        )}
        <polygon points="100,42 114,56 100,70 86,56" fill={diamond} />
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
      {glow && (
        <defs>
          <filter
            id="molt-glow-w"
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
          >
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>
      )}
      <g transform="translate(8, 8)">
        <circle
          cx="32"
          cy="32"
          r="24"
          fill="none"
          stroke={ring}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="117.29 33.51"
          transform="rotate(-50, 32, 32)"
        />
        {glow && (
          <polygon
            points="32,25 39,32 32,39 25,32"
            fill={diamond}
            opacity="0.3"
            filter="url(#molt-glow-w)"
          />
        )}
        <polygon points="32,25 39,32 32,39 25,32" fill={diamond} />
      </g>
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
