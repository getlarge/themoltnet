import { useTheme } from '../hooks.js';

export interface LogoAnimatedProps {
  /** Height in pixels (width matches — it's square) */
  size?: number;
  /** Override the ring/network color */
  ringColor?: string;
  /** Override the diamond/identity color */
  diamondColor?: string;
  /** Additional className */
  className?: string;
  /** Additional inline styles */
  style?: React.CSSProperties;
}

/**
 * Animated Molt Mark for landing pages and hero sections.
 *
 * Animation sequence:
 * 1. Ring draws itself on from nothing (0.2s – 2s)
 * 2. Diamond materializes with a scale bounce + flash (1.6s)
 * 3. Glow pulses rhythmically (continuous)
 * 4. Orbital particles trace the ring (continuous)
 * 5. Shedding fragments drift from the gap (continuous)
 */
export function LogoAnimated({
  size = 256,
  ringColor,
  diamondColor,
  className,
  style,
}: LogoAnimatedProps) {
  const theme = useTheme();

  const ring = ringColor ?? theme.color.primary.DEFAULT;
  const ringHover = ringColor ?? theme.color.primary.hover;
  const diamond = diamondColor ?? theme.color.accent.DEFAULT;

  // Unique ID prefix to avoid SVG filter collisions when multiple instances exist
  const id = 'molt-anim';

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
        <filter
          id={`${id}-glow`}
          x="-100%"
          y="-100%"
          width="300%"
          height="300%"
        >
          <feGaussianBlur stdDeviation="16" />
        </filter>
        <filter
          id={`${id}-flash`}
          x="-150%"
          y="-150%"
          width="400%"
          height="400%"
        >
          <feGaussianBlur stdDeviation="32" />
        </filter>
        <filter
          id={`${id}-pglow`}
          x="-200%"
          y="-200%"
          width="500%"
          height="500%"
        >
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <linearGradient
          id={`${id}-ring-grad`}
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
        >
          <stop offset="0%" stopColor={ringHover} />
          <stop offset="50%" stopColor={ring} />
          <stop offset="100%" stopColor={ring} />
        </linearGradient>
      </defs>

      {/* Ring — draws itself on */}
      <circle
        cx="256"
        cy="256"
        r="192"
        fill="none"
        stroke={`url(#${id}-ring-grad)`}
        strokeWidth="32"
        strokeLinecap="round"
        strokeDasharray="938.29 268.08"
        strokeDashoffset="938.29"
        transform="rotate(-50, 256, 256)"
        opacity="0"
      >
        <animate
          attributeName="opacity"
          values="0;1"
          dur="0.3s"
          begin="0.2s"
          fill="freeze"
        />
        <animate
          attributeName="stroke-dashoffset"
          values="938.29;0"
          dur="1.8s"
          begin="0.2s"
          fill="freeze"
          calcMode="spline"
          keySplines="0.25 0.1 0.25 1"
        />
      </circle>

      {/* Ring afterglow */}
      <circle
        cx="256"
        cy="256"
        r="192"
        fill="none"
        stroke={ring}
        strokeWidth="48"
        strokeLinecap="round"
        strokeDasharray="938.29 268.08"
        transform="rotate(-50, 256, 256)"
        opacity="0"
      >
        <animate
          attributeName="opacity"
          values="0;0.06;0.03"
          dur="1.5s"
          begin="1.8s"
          fill="freeze"
        />
      </circle>

      {/* Shedding fragments */}
      <circle cx="148" cy="108" r="5" fill={ring} opacity="0">
        <animate
          attributeName="opacity"
          values="0;0.5;0.3;0"
          dur="3s"
          begin="2.2s"
          repeatCount="indefinite"
        />
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0,0; -12,-18; -8,-24"
          dur="3s"
          begin="2.2s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="368" cy="104" r="3.5" fill={ring} opacity="0">
        <animate
          attributeName="opacity"
          values="0;0.4;0.2;0"
          dur="3.5s"
          begin="2.6s"
          repeatCount="indefinite"
        />
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0,0; 10,-14; 14,-22"
          dur="3.5s"
          begin="2.6s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="256" cy="60" r="2.5" fill={ring} opacity="0">
        <animate
          attributeName="opacity"
          values="0;0.35;0.15;0"
          dur="4s"
          begin="3s"
          repeatCount="indefinite"
        />
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0,0; 2,-20; -2,-32"
          dur="4s"
          begin="3s"
          repeatCount="indefinite"
        />
      </circle>

      {/* Diamond flash */}
      <polygon
        points="256,200 312,256 256,312 200,256"
        fill={diamond}
        opacity="0"
        filter={`url(#${id}-flash)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.6;0"
          dur="0.8s"
          begin="1.6s"
          fill="freeze"
        />
      </polygon>

      {/* Diamond glow — breathing pulse */}
      <polygon
        points="256,200 312,256 256,312 200,256"
        fill={diamond}
        opacity="0"
        filter={`url(#${id}-glow)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.4"
          dur="0.5s"
          begin="1.6s"
          fill="freeze"
          id={`${id}-glow-appear`}
        />
        <animate
          attributeName="opacity"
          values="0.2;0.35;0.2"
          dur="3s"
          begin={`${id}-glow-appear.end`}
          repeatCount="indefinite"
        />
      </polygon>

      {/* Diamond — scales from 0 with bounce */}
      <g style={{ transformOrigin: '256px 256px' }}>
        <polygon
          points="256,200 312,256 256,312 200,256"
          fill={diamond}
          opacity="0"
        >
          <animate
            attributeName="opacity"
            values="0;1"
            dur="0.4s"
            begin="1.6s"
            fill="freeze"
          />
        </polygon>
        <animateTransform
          attributeName="transform"
          type="scale"
          values="0;1.15;1"
          dur="0.6s"
          begin="1.6s"
          fill="freeze"
          calcMode="spline"
          keySplines="0.34 1.56 0.64 1; 0.25 0.1 0.25 1"
        />
      </g>

      {/* Orbital particles */}
      <circle
        id={`${id}-orbit`}
        cx="256"
        cy="256"
        r="192"
        fill="none"
        stroke="none"
        transform="rotate(-50, 256, 256)"
      />
      <circle
        r="6"
        fill={ringHover}
        opacity="0"
        filter={`url(#${id}-pglow)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.7;0.7;0"
          keyTimes="0;0.05;0.85;1"
          dur="4s"
          begin="2.5s"
          repeatCount="indefinite"
        />
        <animateMotion
          dur="4s"
          begin="2.5s"
          repeatCount="indefinite"
          rotate="auto"
        >
          <mpath href={`#${id}-orbit`} />
        </animateMotion>
      </circle>
      <circle
        r="4"
        fill={diamond}
        opacity="0"
        filter={`url(#${id}-pglow)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.5;0.5;0"
          keyTimes="0;0.05;0.85;1"
          dur="5s"
          begin="3.5s"
          repeatCount="indefinite"
        />
        <animateMotion
          dur="5s"
          begin="3.5s"
          repeatCount="indefinite"
          rotate="auto"
        >
          <mpath href={`#${id}-orbit`} />
        </animateMotion>
      </circle>

      {/* Ambient halo pulse */}
      <circle cx="256" cy="256" r="192" fill="none" stroke={ring} strokeWidth="1" opacity="0">
        <animate
          attributeName="opacity"
          values="0;0.15;0.05;0.15"
          dur="4s"
          begin="2.5s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="r"
          values="192;196;192"
          dur="4s"
          begin="2.5s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}
