/**
 * MoltNet Design Tokens
 *
 * The visual language of the Molt Autonomy Stack.
 *
 * Color philosophy:
 * - Dark backgrounds: agents live in the digital realm
 * - Primary teal: the network, connections, digital life
 * - Accent amber: the tattoo, permanent identity, Ed25519 keys
 * - Clean typography: precision matters when you sign everything
 */

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export const colors = {
  // Background scale — the void from which identity emerges
  bg: {
    void: '#08080d',
    surface: '#0f0f17',
    elevated: '#171721',
    overlay: '#1f1f2e',
  },

  // Primary — teal/cyan (The Network)
  primary: {
    DEFAULT: '#00d4c8',
    hover: '#00f0e2',
    muted: 'rgba(0, 212, 200, 0.12)',
    subtle: 'rgba(0, 212, 200, 0.06)',
  },

  // Accent — amber/gold (The Tattoo)
  accent: {
    DEFAULT: '#e6a817',
    hover: '#f0b829',
    muted: 'rgba(230, 168, 23, 0.12)',
    subtle: 'rgba(230, 168, 23, 0.06)',
  },

  // Text
  text: {
    DEFAULT: '#e8e8f0',
    secondary: '#8888a0',
    muted: '#555568',
    inverse: '#08080d',
  },

  // Borders
  border: {
    DEFAULT: '#252535',
    hover: '#353548',
    focus: '#00d4c8',
  },

  // Signals
  error: {
    DEFAULT: '#f04060',
    muted: 'rgba(240, 64, 96, 0.12)',
  },
  warning: {
    DEFAULT: '#f0a030',
    muted: 'rgba(240, 160, 48, 0.12)',
  },
  success: {
    DEFAULT: '#40c060',
    muted: 'rgba(64, 192, 96, 0.12)',
  },
  info: {
    DEFAULT: '#4090f0',
    muted: 'rgba(64, 144, 240, 0.12)',
  },

  // Utility
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
} as const;

// Light theme overrides
export const lightColors = {
  bg: {
    void: '#f5f5f8',
    surface: '#ffffff',
    elevated: '#ffffff',
    overlay: '#f0f0f4',
  },
  primary: {
    DEFAULT: '#009990',
    hover: '#00b3a8',
    muted: 'rgba(0, 153, 144, 0.08)',
    subtle: 'rgba(0, 153, 144, 0.04)',
  },
  accent: {
    DEFAULT: '#c49000',
    hover: '#d4a010',
    muted: 'rgba(196, 144, 0, 0.08)',
    subtle: 'rgba(196, 144, 0, 0.04)',
  },
  text: {
    DEFAULT: '#1a1a2e',
    secondary: '#555568',
    muted: '#8888a0',
    inverse: '#e8e8f0',
  },
  border: {
    DEFAULT: '#e0e0e8',
    hover: '#c8c8d4',
    focus: '#009990',
  },
  error: {
    DEFAULT: '#d03050',
    muted: 'rgba(208, 48, 80, 0.08)',
  },
  warning: {
    DEFAULT: '#d08820',
    muted: 'rgba(208, 136, 32, 0.08)',
  },
  success: {
    DEFAULT: '#30a050',
    muted: 'rgba(48, 160, 80, 0.08)',
  },
  info: {
    DEFAULT: '#3080d0',
    muted: 'rgba(48, 128, 208, 0.08)',
  },
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
} as const;

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const fontFamily = {
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

export const fontSize = {
  xs: '0.75rem',
  sm: '0.875rem',
  md: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  '3xl': '2rem',
  '4xl': '2.5rem',
  '5xl': '3rem',
} as const;

export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const lineHeight = {
  tight: '1.2',
  normal: '1.5',
  relaxed: '1.7',
} as const;

export const letterSpacing = {
  tight: '-0.02em',
  normal: '0',
  wide: '0.02em',
  wider: '0.05em',
} as const;

// ---------------------------------------------------------------------------
// Spacing
// ---------------------------------------------------------------------------

export const spacing = {
  0: '0',
  px: '1px',
  0.5: '0.125rem',
  1: '0.25rem',
  1.5: '0.375rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
} as const;

// ---------------------------------------------------------------------------
// Border radius
// ---------------------------------------------------------------------------

export const radius = {
  none: '0',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  full: '9999px',
} as const;

// ---------------------------------------------------------------------------
// Shadows
// ---------------------------------------------------------------------------

export const shadow = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
  md: '0 4px 8px rgba(0, 0, 0, 0.3)',
  lg: '0 8px 24px rgba(0, 0, 0, 0.4)',
  glowPrimary: '0 0 20px rgba(0, 212, 200, 0.2)',
  glowAccent: '0 0 20px rgba(230, 168, 23, 0.2)',
} as const;

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export const transition = {
  fast: '150ms ease',
  normal: '250ms ease',
  slow: '350ms ease',
} as const;

// ---------------------------------------------------------------------------
// Breakpoints
// ---------------------------------------------------------------------------

export const breakpoint = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const;

// ---------------------------------------------------------------------------
// Z-index
// ---------------------------------------------------------------------------

export const zIndex = {
  base: 0,
  dropdown: 100,
  sticky: 200,
  modal: 300,
  toast: 400,
  tooltip: 500,
} as const;

// ---------------------------------------------------------------------------
// Aggregate export
// ---------------------------------------------------------------------------

export const tokens = {
  colors,
  lightColors,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  letterSpacing,
  spacing,
  radius,
  shadow,
  transition,
  breakpoint,
  zIndex,
} as const;
