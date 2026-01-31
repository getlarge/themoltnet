import { useTheme } from '../hooks.js';
import type { BaseComponentProps } from '../types.js';

export type CardVariant = 'surface' | 'elevated' | 'outlined' | 'ghost';

export interface CardProps extends BaseComponentProps {
  variant?: CardVariant;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  glow?: 'primary' | 'accent' | 'none';
}

export function Card({
  variant = 'surface',
  padding = 'md',
  glow = 'none',
  style,
  children,
  ...rest
}: CardProps) {
  const theme = useTheme();

  const paddingMap = {
    none: '0',
    sm: theme.spacing[3],
    md: theme.spacing[5],
    lg: theme.spacing[8],
  };

  const variantStyles: Record<CardVariant, React.CSSProperties> = {
    surface: {
      background: theme.color.bg.surface,
      border: `1px solid ${theme.color.border.DEFAULT}`,
    },
    elevated: {
      background: theme.color.bg.elevated,
      border: `1px solid ${theme.color.border.DEFAULT}`,
      boxShadow: theme.shadow.md,
    },
    outlined: {
      background: 'transparent',
      border: `1px solid ${theme.color.border.DEFAULT}`,
    },
    ghost: {
      background: 'transparent',
      border: 'none',
    },
  };

  const glowShadow =
    glow === 'primary'
      ? theme.shadow.glowPrimary
      : glow === 'accent'
        ? theme.shadow.glowAccent
        : undefined;

  const computed: React.CSSProperties = {
    borderRadius: theme.radius.lg,
    padding: paddingMap[padding],
    ...variantStyles[variant],
    boxShadow: glowShadow ?? variantStyles[variant].boxShadow,
    ...style,
  };

  return (
    <div style={computed} {...rest}>
      {children}
    </div>
  );
}
