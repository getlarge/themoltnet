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

// Diamond facet colors — derived from accent amber
const FACETS = {
  topRight: '#f0b829',
  bottomRight: '#e6a817',
  bottomLeft: '#c89010',
  topLeft: '#d9a015',
  edge: '#f5c838',
} as const;

/**
 * Animated Molt Mark — premium V2 for landing pages and hero sections.
 *
 * Choreographed reveal sequence:
 * 1. Ambient radiance fades in (0.2s)
 * 2. Inner detail rings appear (0.4s)
 * 3. Gradient ring draws itself on (0.6s – 2.2s)
 * 4. Ring bloom + edge highlight settle (1.8s)
 * 5. Gap endpoint nodes pop in (2.0s)
 * 6. Faceted diamond materializes with bounce + flash (2.2s)
 * 7. Radial accent lines appear sequentially (2.6s)
 * 8. Orbital particles begin tracing (3.0s)
 * 9. Shedding fragments drift from gap (3.2s)
 * 10. Breathing glow loop (continuous)
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
  const ringLight = ringColor ?? theme.color.primary.hover;
  const diamond = diamondColor ?? theme.color.accent.DEFAULT;

  // Unique ID prefix to avoid SVG filter collisions
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
        <linearGradient id={`${id}-ring-grad`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={ringLight} />
          <stop offset="45%" stopColor={ring} />
          <stop offset="100%" stopColor={ring} />
        </linearGradient>
        {/* Wide ambient glow */}
        <filter id={`${id}-gw`} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="24" />
        </filter>
        {/* Tight diamond glow */}
        <filter id={`${id}-gt`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        {/* Ring bloom */}
        <filter id={`${id}-gr`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
        {/* Node glow */}
        <filter id={`${id}-gn`} x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        {/* Diamond flash */}
        <filter
          id={`${id}-flash`}
          x="-150%"
          y="-150%"
          width="400%"
          height="400%"
        >
          <feGaussianBlur stdDeviation="32" />
        </filter>
        {/* Particle glow */}
        <filter
          id={`${id}-pglow`}
          x="-200%"
          y="-200%"
          width="500%"
          height="500%"
        >
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* === Phase 1: Ambient background radiance (0.2s) === */}
      <circle
        cx="256"
        cy="256"
        r="120"
        fill={diamond}
        opacity="0"
        filter={`url(#${id}-gw)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.035"
          dur="1s"
          begin="0.2s"
          fill="freeze"
        />
      </circle>
      <circle
        cx="256"
        cy="256"
        r="200"
        fill={ring}
        opacity="0"
        filter={`url(#${id}-gw)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.02"
          dur="1s"
          begin="0.2s"
          fill="freeze"
        />
      </circle>

      {/* === Phase 2: Inner detail rings (0.4s) === */}
      <circle
        cx="256"
        cy="256"
        r="152"
        fill="none"
        stroke={ring}
        strokeWidth="1"
        strokeDasharray="8 12"
        opacity="0"
      >
        <animate
          attributeName="opacity"
          values="0;0.2"
          dur="0.8s"
          begin="0.4s"
          fill="freeze"
        />
      </circle>
      <circle
        cx="256"
        cy="256"
        r="144"
        fill="none"
        stroke={ring}
        strokeWidth="0.5"
        opacity="0"
      >
        <animate
          attributeName="opacity"
          values="0;0.08"
          dur="0.8s"
          begin="0.4s"
          fill="freeze"
        />
      </circle>

      {/* === Phase 3: Ring draws on (0.6s – 2.2s) === */}
      {/* Ring bloom (background glow behind ring) */}
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
        opacity="0"
        filter={`url(#${id}-gr)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.07"
          dur="0.6s"
          begin="1.8s"
          fill="freeze"
        />
      </circle>

      {/* Main outer ring — draw on animation */}
      <circle
        cx="256"
        cy="256"
        r="196"
        fill="none"
        stroke={`url(#${id}-ring-grad)`}
        strokeWidth="26"
        strokeLinecap="round"
        strokeDasharray="985.20 246.30"
        strokeDashoffset="985.20"
        transform="rotate(-54, 256, 256)"
        opacity="0"
      >
        <animate
          attributeName="opacity"
          values="0;1"
          dur="0.3s"
          begin="0.6s"
          fill="freeze"
        />
        <animate
          attributeName="stroke-dashoffset"
          values="985.20;0"
          dur="1.6s"
          begin="0.6s"
          fill="freeze"
          calcMode="spline"
          keySplines="0.25 0.1 0.25 1"
        />
      </circle>

      {/* Inner edge highlight (bevel) */}
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
        opacity="0"
      >
        <animate
          attributeName="opacity"
          values="0;0.2"
          dur="0.6s"
          begin="1.8s"
          fill="freeze"
        />
      </circle>

      {/* === Phase 4: Gap endpoint nodes (2.0s) === */}
      {/* Node glows */}
      <circle
        cx="371"
        cy="97"
        r="4"
        fill={ring}
        opacity="0"
        filter={`url(#${id}-gn)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.15"
          dur="0.4s"
          begin="2.0s"
          fill="freeze"
        />
      </circle>
      <circle
        cx="141"
        cy="97"
        r="4"
        fill={ring}
        opacity="0"
        filter={`url(#${id}-gn)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.15"
          dur="0.4s"
          begin="2.0s"
          fill="freeze"
        />
      </circle>
      {/* Node cores — pop in */}
      <circle cx="371" cy="97" r="3" fill={ringLight} opacity="0">
        <animate
          attributeName="opacity"
          values="0;0.6"
          dur="0.3s"
          begin="2.1s"
          fill="freeze"
        />
      </circle>
      <circle cx="141" cy="97" r="3" fill={ringLight} opacity="0">
        <animate
          attributeName="opacity"
          values="0;0.6"
          dur="0.3s"
          begin="2.1s"
          fill="freeze"
        />
      </circle>

      {/* === Phase 5: Diamond materializes (2.2s) === */}
      {/* Diamond flash */}
      <polygon
        points="256,206 306,256 256,306 206,256"
        fill={diamond}
        opacity="0"
        filter={`url(#${id}-flash)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.6;0"
          dur="0.8s"
          begin="2.2s"
          fill="freeze"
        />
      </polygon>

      {/* Diamond wide glow — fades in then breathes */}
      <polygon
        points="256,206 306,256 256,306 206,256"
        fill={diamond}
        opacity="0"
        filter={`url(#${id}-gw)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.12"
          dur="0.5s"
          begin="2.2s"
          fill="freeze"
          id={`${id}-gw-appear`}
        />
        <animate
          attributeName="opacity"
          values="0.08;0.14;0.08"
          dur="3s"
          begin={`${id}-gw-appear.end`}
          repeatCount="indefinite"
        />
      </polygon>

      {/* Diamond tight glow — breathes */}
      <polygon
        points="256,206 306,256 256,306 206,256"
        fill={diamond}
        opacity="0"
        filter={`url(#${id}-gt)`}
      >
        <animate
          attributeName="opacity"
          values="0;0.25"
          dur="0.5s"
          begin="2.2s"
          fill="freeze"
          id={`${id}-gt-appear`}
        />
        <animate
          attributeName="opacity"
          values="0.15;0.3;0.15"
          dur="3s"
          begin={`${id}-gt-appear.end`}
          repeatCount="indefinite"
        />
      </polygon>

      {/* Faceted diamond — bounce in with elastic easing */}
      <g style={{ transformOrigin: '256px 256px' }}>
        <g opacity="0">
          <polygon points="256,206 306,256 256,256" fill={FACETS.topRight} />
          <polygon points="306,256 256,306 256,256" fill={FACETS.bottomRight} />
          <polygon points="256,306 206,256 256,256" fill={FACETS.bottomLeft} />
          <polygon points="206,256 256,206 256,256" fill={FACETS.topLeft} />
          {/* Edge highlight */}
          <polygon
            points="256,206 306,256 256,306 206,256"
            fill="none"
            stroke={FACETS.edge}
            strokeWidth="1"
            strokeLinejoin="miter"
            opacity="0.35"
          />
          {/* Facet cross lines */}
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
          <animate
            attributeName="opacity"
            values="0;1"
            dur="0.4s"
            begin="2.2s"
            fill="freeze"
          />
        </g>
        <animateTransform
          attributeName="transform"
          type="scale"
          values="0;1.18;0.95;1.02;1"
          dur="0.8s"
          begin="2.2s"
          fill="freeze"
          calcMode="spline"
          keySplines="0.34 1.56 0.64 1; 0.25 0.1 0.25 1; 0.42 0 0.58 1; 0.25 0.1 0.25 1"
        />
      </g>

      {/* === Phase 6: Radial accent lines (2.6s – 2.9s, staggered) === */}
      <line
        x1="256"
        y1="200"
        x2="256"
        y2="164"
        stroke={ring}
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0"
      >
        <animate
          attributeName="opacity"
          values="0;0.1"
          dur="0.4s"
          begin="2.6s"
          fill="freeze"
        />
      </line>
      <line
        x1="312"
        y1="256"
        x2="348"
        y2="256"
        stroke={ring}
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0"
      >
        <animate
          attributeName="opacity"
          values="0;0.1"
          dur="0.4s"
          begin="2.7s"
          fill="freeze"
        />
      </line>
      <line
        x1="256"
        y1="312"
        x2="256"
        y2="348"
        stroke={ring}
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0"
      >
        <animate
          attributeName="opacity"
          values="0;0.1"
          dur="0.4s"
          begin="2.8s"
          fill="freeze"
        />
      </line>
      <line
        x1="200"
        y1="256"
        x2="164"
        y2="256"
        stroke={ring}
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0"
      >
        <animate
          attributeName="opacity"
          values="0;0.1"
          dur="0.4s"
          begin="2.9s"
          fill="freeze"
        />
      </line>

      {/* === Phase 7: Orbital particles (3.0s) === */}
      <circle
        id={`${id}-orbit`}
        cx="256"
        cy="256"
        r="196"
        fill="none"
        stroke="none"
        transform="rotate(-54, 256, 256)"
      />
      <circle r="6" fill={ringLight} opacity="0" filter={`url(#${id}-pglow)`}>
        <animate
          attributeName="opacity"
          values="0;0.7;0.7;0"
          keyTimes="0;0.05;0.85;1"
          dur="4s"
          begin="3.0s"
          repeatCount="indefinite"
        />
        <animateMotion
          dur="4s"
          begin="3.0s"
          repeatCount="indefinite"
          rotate="auto"
        >
          <mpath href={`#${id}-orbit`} />
        </animateMotion>
      </circle>
      <circle r="4" fill={diamond} opacity="0" filter={`url(#${id}-pglow)`}>
        <animate
          attributeName="opacity"
          values="0;0.5;0.5;0"
          keyTimes="0;0.05;0.85;1"
          dur="5s"
          begin="3.8s"
          repeatCount="indefinite"
        />
        <animateMotion
          dur="5s"
          begin="3.8s"
          repeatCount="indefinite"
          rotate="auto"
        >
          <mpath href={`#${id}-orbit`} />
        </animateMotion>
      </circle>

      {/* === Phase 8: Shedding fragments (3.2s) === */}
      <circle cx="141" cy="97" r="5" fill={ring} opacity="0">
        <animate
          attributeName="opacity"
          values="0;0.5;0.3;0"
          dur="3s"
          begin="3.2s"
          repeatCount="indefinite"
        />
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0,0; -12,-18; -8,-24"
          dur="3s"
          begin="3.2s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="371" cy="97" r="3.5" fill={ring} opacity="0">
        <animate
          attributeName="opacity"
          values="0;0.4;0.2;0"
          dur="3.5s"
          begin="3.6s"
          repeatCount="indefinite"
        />
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0,0; 10,-14; 14,-22"
          dur="3.5s"
          begin="3.6s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="256" cy="60" r="2.5" fill={ring} opacity="0">
        <animate
          attributeName="opacity"
          values="0;0.35;0.15;0"
          dur="4s"
          begin="4.0s"
          repeatCount="indefinite"
        />
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0,0; 2,-20; -2,-32"
          dur="4s"
          begin="4.0s"
          repeatCount="indefinite"
        />
      </circle>

      {/* Ambient halo pulse */}
      <circle
        cx="256"
        cy="256"
        r="196"
        fill="none"
        stroke={ring}
        strokeWidth="1"
        opacity="0"
      >
        <animate
          attributeName="opacity"
          values="0;0.15;0.05;0.15"
          dur="4s"
          begin="3.0s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="r"
          values="196;200;196"
          dur="4s"
          begin="3.0s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}
