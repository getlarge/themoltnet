import { createElement, type ElementType } from 'react';

import { useTheme } from '../hooks.js';
import type { BaseComponentProps } from '../types.js';

export type TextVariant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'body'
  | 'bodyLarge'
  | 'caption'
  | 'overline';

export type TextColor =
  | 'default'
  | 'secondary'
  | 'muted'
  | 'primary'
  | 'accent'
  | 'error'
  | 'success'
  | 'warning';

export interface TextProps extends BaseComponentProps {
  variant?: TextVariant;
  color?: TextColor;
  as?: ElementType;
  mono?: boolean;
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  align?: 'left' | 'center' | 'right';
}

const defaultElements: Record<TextVariant, ElementType> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  body: 'p',
  bodyLarge: 'p',
  caption: 'span',
  overline: 'span',
};

export function Text({
  variant = 'body',
  color = 'default',
  as,
  mono,
  weight,
  align,
  style,
  children,
  ...rest
}: TextProps) {
  const theme = useTheme();
  const element = as ?? defaultElements[variant];

  const variantStyles: Record<TextVariant, React.CSSProperties> = {
    h1: {
      fontSize: theme.font.size['4xl'],
      fontWeight: theme.font.weight.bold,
      lineHeight: theme.font.lineHeight.tight,
      letterSpacing: theme.font.letterSpacing.tight,
      margin: 0,
    },
    h2: {
      fontSize: theme.font.size['3xl'],
      fontWeight: theme.font.weight.bold,
      lineHeight: theme.font.lineHeight.tight,
      letterSpacing: theme.font.letterSpacing.tight,
      margin: 0,
    },
    h3: {
      fontSize: theme.font.size['2xl'],
      fontWeight: theme.font.weight.semibold,
      lineHeight: theme.font.lineHeight.tight,
      margin: 0,
    },
    h4: {
      fontSize: theme.font.size.xl,
      fontWeight: theme.font.weight.semibold,
      lineHeight: theme.font.lineHeight.tight,
      margin: 0,
    },
    body: {
      fontSize: theme.font.size.md,
      fontWeight: theme.font.weight.normal,
      lineHeight: theme.font.lineHeight.normal,
      margin: 0,
    },
    bodyLarge: {
      fontSize: theme.font.size.lg,
      fontWeight: theme.font.weight.normal,
      lineHeight: theme.font.lineHeight.relaxed,
      margin: 0,
    },
    caption: {
      fontSize: theme.font.size.sm,
      fontWeight: theme.font.weight.normal,
      lineHeight: theme.font.lineHeight.normal,
      margin: 0,
    },
    overline: {
      fontSize: theme.font.size.xs,
      fontWeight: theme.font.weight.semibold,
      lineHeight: theme.font.lineHeight.normal,
      letterSpacing: theme.font.letterSpacing.wider,
      textTransform: 'uppercase',
      margin: 0,
    },
  };

  const colorMap: Record<TextColor, string> = {
    default: theme.color.text.DEFAULT,
    secondary: theme.color.text.secondary,
    muted: theme.color.text.muted,
    primary: theme.color.primary.DEFAULT,
    accent: theme.color.accent.DEFAULT,
    error: theme.color.error.DEFAULT,
    success: theme.color.success.DEFAULT,
    warning: theme.color.warning.DEFAULT,
  };

  const computed: React.CSSProperties = {
    ...variantStyles[variant],
    color: colorMap[color],
    fontFamily: mono ? theme.font.family.mono : undefined,
    fontWeight: weight ? theme.font.weight[weight] : undefined,
    textAlign: align,
    ...style,
  };

  return createElement(element, { style: computed, ...rest }, children);
}
