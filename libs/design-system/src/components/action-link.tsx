import type { AnchorHTMLAttributes } from 'react';

import { useInteractive, useTheme } from '../hooks.js';
import type { Size } from '../types.js';
import type { ButtonVariant } from './button.js';

export interface ActionLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Exclude<ButtonVariant, 'danger'>;
  size?: Size;
}

const sizeStyles: Record<Size, React.CSSProperties> = {
  sm: { padding: '0.375rem 0.75rem', fontSize: '0.875rem', minHeight: '44px' },
  md: { padding: '0.5rem 1rem', fontSize: '1rem', minHeight: '44px' },
  lg: { padding: '0.625rem 1.5rem', fontSize: '1.125rem', minHeight: '48px' },
};

/**
 * Navigation counterpart to Button. It preserves native link semantics while
 * sharing the design system's action hierarchy, touch targets, and focus ring.
 */
export function ActionLink({
  variant = 'primary',
  size = 'md',
  style,
  children,
  ...rest
}: ActionLinkProps) {
  const theme = useTheme();
  const { hovered, focused, pressed, handlers } = useInteractive();

  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    borderRadius: theme.radius.md,
    fontFamily: 'inherit',
    fontWeight: theme.font.weight.medium,
    lineHeight: theme.font.lineHeight.normal,
    textDecoration: 'none',
    transition: `background ${theme.transition.fast}, color ${theme.transition.fast}, box-shadow ${theme.transition.fast}, opacity ${theme.transition.fast}`,
    opacity: pressed ? 0.85 : 1,
    outline: 'none',
    ...sizeStyles[size],
  };

  const variants: Record<
    Exclude<ButtonVariant, 'danger'>,
    React.CSSProperties
  > = {
    primary: {
      background: hovered
        ? theme.color.primary.hover
        : theme.color.primary.DEFAULT,
      color: theme.color.text.inverse,
      boxShadow: focused
        ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.primary.DEFAULT}`
        : 'none',
    },
    secondary: {
      background: hovered ? theme.color.primary.muted : 'transparent',
      color: theme.color.primary.DEFAULT,
      boxShadow: focused
        ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.primary.DEFAULT}`
        : `inset 0 0 0 1px ${theme.color.border.DEFAULT}`,
    },
    ghost: {
      background: hovered ? theme.color.primary.subtle : 'transparent',
      color: hovered ? theme.color.primary.DEFAULT : theme.color.text.DEFAULT,
      boxShadow: focused
        ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.primary.DEFAULT}`
        : 'none',
    },
    accent: {
      background: hovered
        ? theme.color.accent.hover
        : theme.color.accent.DEFAULT,
      color: theme.color.text.inverse,
      boxShadow: focused
        ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.accent.DEFAULT}`
        : 'none',
    },
  };

  return (
    <a
      style={{ ...base, ...variants[variant], ...style }}
      {...handlers}
      {...rest}
    >
      {children}
    </a>
  );
}
