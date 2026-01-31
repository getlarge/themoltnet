import { useTheme } from '../hooks.js';
import type { BaseComponentProps, Signal } from '../types.js';

export type BadgeVariant = 'default' | 'primary' | 'accent' | Signal;

export interface BadgeProps extends BaseComponentProps {
  variant?: BadgeVariant;
}

export function Badge({
  variant = 'default',
  style,
  children,
  ...rest
}: BadgeProps) {
  const theme = useTheme();

  const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
    default: {
      background: theme.color.bg.overlay,
      color: theme.color.text.secondary,
    },
    primary: {
      background: theme.color.primary.muted,
      color: theme.color.primary.DEFAULT,
    },
    accent: {
      background: theme.color.accent.muted,
      color: theme.color.accent.DEFAULT,
    },
    error: {
      background: theme.color.error.muted,
      color: theme.color.error.DEFAULT,
    },
    warning: {
      background: theme.color.warning.muted,
      color: theme.color.warning.DEFAULT,
    },
    success: {
      background: theme.color.success.muted,
      color: theme.color.success.DEFAULT,
    },
    info: {
      background: theme.color.info.muted,
      color: theme.color.info.DEFAULT,
    },
  };

  const computed: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: `${theme.spacing[0.5]} ${theme.spacing[2]}`,
    borderRadius: theme.radius.full,
    fontSize: theme.font.size.xs,
    fontWeight: theme.font.weight.medium,
    lineHeight: theme.font.lineHeight.normal,
    whiteSpace: 'nowrap',
    ...variantStyles[variant],
    ...style,
  };

  return (
    <span style={computed} {...rest}>
      {children}
    </span>
  );
}
