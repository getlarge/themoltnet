import {
  breakpoint,
  colors,
  fontFamily,
  fontSize,
  fontWeight,
  letterSpacing,
  lightColors,
  lineHeight,
  radius,
  shadow,
  spacing,
  transition,
  zIndex,
} from './tokens.js';

// ---------------------------------------------------------------------------
// Color shape types (widened from literal strings so both themes fit)
// ---------------------------------------------------------------------------

interface ColorScale {
  readonly void: string;
  readonly surface: string;
  readonly elevated: string;
  readonly overlay: string;
}

interface PaletteScale {
  readonly DEFAULT: string;
  readonly hover: string;
  readonly muted: string;
  readonly subtle: string;
}

interface TextScale {
  readonly DEFAULT: string;
  readonly secondary: string;
  readonly muted: string;
  readonly inverse: string;
}

interface BorderScale {
  readonly DEFAULT: string;
  readonly hover: string;
  readonly focus: string;
}

interface SignalScale {
  readonly DEFAULT: string;
  readonly muted: string;
}

// ---------------------------------------------------------------------------
// Theme type
// ---------------------------------------------------------------------------

export interface MoltTheme {
  mode: 'dark' | 'light';
  color: {
    bg: ColorScale;
    primary: PaletteScale;
    accent: PaletteScale;
    text: TextScale;
    border: BorderScale;
    error: SignalScale;
    warning: SignalScale;
    success: SignalScale;
    info: SignalScale;
    white: string;
    black: string;
    transparent: string;
  };
  font: {
    family: typeof fontFamily;
    size: typeof fontSize;
    weight: typeof fontWeight;
    lineHeight: typeof lineHeight;
    letterSpacing: typeof letterSpacing;
  };
  spacing: typeof spacing;
  radius: typeof radius;
  shadow: typeof shadow;
  transition: typeof transition;
  breakpoint: typeof breakpoint;
  zIndex: typeof zIndex;
}

// ---------------------------------------------------------------------------
// Theme instances
// ---------------------------------------------------------------------------

const sharedTokens = {
  font: {
    family: fontFamily,
    size: fontSize,
    weight: fontWeight,
    lineHeight,
    letterSpacing,
  },
  spacing,
  radius,
  shadow,
  transition,
  breakpoint,
  zIndex,
} as const;

export const darkTheme: MoltTheme = {
  mode: 'dark',
  color: {
    bg: colors.bg,
    primary: colors.primary,
    accent: colors.accent,
    text: colors.text,
    border: colors.border,
    error: colors.error,
    warning: colors.warning,
    success: colors.success,
    info: colors.info,
    white: colors.white,
    black: colors.black,
    transparent: colors.transparent,
  },
  ...sharedTokens,
};

export const lightTheme: MoltTheme = {
  mode: 'light',
  color: {
    bg: lightColors.bg,
    primary: lightColors.primary,
    accent: lightColors.accent,
    text: lightColors.text,
    border: lightColors.border,
    error: lightColors.error,
    warning: lightColors.warning,
    success: lightColors.success,
    info: lightColors.info,
    white: lightColors.white,
    black: lightColors.black,
    transparent: lightColors.transparent,
  },
  ...sharedTokens,
};
