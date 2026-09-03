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
    // WCAG AA (>=4.5:1) on bg.void/surface; was #555568 (~2.6:1). See #1643.
    muted: '#7d7d96',
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
  // Light primary/accent are darkened so they meet WCAG AA both as text on
  // light surfaces (>=4.5:1 vs #fff) and as fills under inverse text (>=4.5:1
  // vs #e8e8f0). Hover goes darker/richer (not lighter) in light theme. #1643.
  primary: {
    DEFAULT: '#007068',
    hover: '#005c54',
    muted: 'rgba(0, 112, 104, 0.08)',
    subtle: 'rgba(0, 112, 104, 0.04)',
  },
  accent: {
    // Dark enough that inverse text (#e8e8f0) on an accent *fill* (button) also
    // clears AA (4.90:1), not just accent-as-text on white (5.97:1). #1643.
    DEFAULT: '#805e00',
    hover: '#725400',
    muted: 'rgba(128, 94, 0, 0.08)',
    subtle: 'rgba(128, 94, 0, 0.04)',
  },
  text: {
    DEFAULT: '#1a1a2e',
    secondary: '#555568',
    // WCAG AA (>=4.5:1) on light bg.void/surface; was #8888a0 (~3.3:1). See #1643.
    muted: '#6b6b80',
    inverse: '#e8e8f0',
  },
  border: {
    DEFAULT: '#e0e0e8',
    hover: '#c8c8d4',
    focus: '#007068',
  },
  // Light signals darkened to meet WCAG AA as text/badges on light surfaces and
  // their muted tints; warning stays distinctly orange (vs the amber accent). #1643.
  error: {
    // Dark enough that the danger button (error fill + inverse text) clears AA
    // (4.87:1) in light theme; also fine as error text on white (5.93:1). #1643.
    DEFAULT: '#c0223f',
    muted: 'rgba(192, 34, 63, 0.08)',
  },
  warning: {
    DEFAULT: '#a05500',
    muted: 'rgba(160, 85, 0, 0.08)',
  },
  success: {
    DEFAULT: '#18783a',
    muted: 'rgba(24, 120, 58, 0.08)',
  },
  info: {
    DEFAULT: '#2166b8',
    muted: 'rgba(33, 102, 184, 0.08)',
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
  /** Page-level display headline (DESIGN.md typography.display). */
  display: 'clamp(3rem, 7vw, 5.75rem)',
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
// Application shell
// ---------------------------------------------------------------------------

export const layout = {
  sidebarExpanded: '16.5rem',
  sidebarCollapsed: '4rem',
  topbarHeight: '3.5rem',
  contentMax: '90rem',
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
  layout,
  zIndex,
} as const;
