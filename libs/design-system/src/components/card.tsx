import { useInteractive, useTheme } from '../hooks.js';
import type { BaseComponentProps } from '../types.js';

export type CardVariant = 'surface' | 'elevated' | 'outlined' | 'ghost';

export interface CardProps extends BaseComponentProps {
  variant?: CardVariant;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  glow?: 'primary' | 'accent' | 'none';
  interactive?: boolean;
  href?: string;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  onClick?: React.MouseEventHandler<
    HTMLAnchorElement | HTMLButtonElement | HTMLDivElement
  >;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

export function Card({
  variant = 'surface',
  padding = 'md',
  glow = 'none',
  interactive,
  href,
  type = 'button',
  disabled,
  style,
  children,
  ...rest
}: CardProps) {
  const theme = useTheme();
  const { focused, hovered, handlers } = useInteractive();
  const isInteractive = interactive || Boolean(href);

  const paddingMap = {
    none: '0',
    sm: theme.spacing[3],
    md: theme.spacing[5],
    lg: theme.spacing[8],
  };

  const variantStyles: Record<CardVariant, React.CSSProperties> = {
    surface: {
      background: theme.color.bg.surface,
      border: `1px solid ${
        isInteractive && hovered && !disabled
          ? theme.color.border.hover
          : theme.color.border.DEFAULT
      }`,
    },
    elevated: {
      background: theme.color.bg.elevated,
      border: `1px solid ${
        isInteractive && hovered && !disabled
          ? theme.color.border.hover
          : theme.color.border.DEFAULT
      }`,
      boxShadow: theme.shadow.md,
    },
    outlined: {
      background: 'transparent',
      border: `1px solid ${
        isInteractive && hovered && !disabled
          ? theme.color.border.hover
          : theme.color.border.DEFAULT
      }`,
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
    display: 'block',
    borderRadius: theme.radius.lg,
    padding: paddingMap[padding],
    ...variantStyles[variant],
    boxShadow: focused
      ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.primary.DEFAULT}`
      : (glowShadow ?? variantStyles[variant].boxShadow),
    outline: 'none',
    transition: `box-shadow ${theme.transition.fast}, border-color ${theme.transition.fast}, opacity ${theme.transition.fast}`,
    ...style,
  };

  if (href) {
    return (
      <a
        href={href}
        style={{
          ...computed,
          color: 'inherit',
          textDecoration: 'none',
          cursor: 'pointer',
        }}
        {...handlers}
        {...rest}
      >
        {children}
      </a>
    );
  }

  if (interactive) {
    return (
      <button
        type={type}
        disabled={disabled}
        style={{
          ...computed,
          width: '100%',
          appearance: 'none',
          border:
            variantStyles[variant].border ??
            `1px solid ${theme.color.border.DEFAULT}`,
          color: 'inherit',
          font: 'inherit',
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
        {...handlers}
        {...rest}
      >
        {children}
      </button>
    );
  }

  return (
    <div style={computed} {...rest}>
      {children}
    </div>
  );
}
