import type { ButtonHTMLAttributes } from 'react';
import { useTheme, useInteractive } from '../hooks.js';
import type { Size } from '../types.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent';

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: Size;
}

const sizeStyles: Record<Size, React.CSSProperties> = {
  sm: { padding: '0.375rem 0.75rem', fontSize: '0.875rem' },
  md: { padding: '0.5rem 1rem', fontSize: '1rem' },
  lg: { padding: '0.625rem 1.5rem', fontSize: '1.125rem' },
};

export function Button({
  variant = 'primary',
  size = 'md',
  disabled,
  style,
  children,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const { hovered, focused, pressed, handlers } = useInteractive();

  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    border: 'none',
    borderRadius: theme.radius.md,
    fontFamily: 'inherit',
    fontWeight: theme.font.weight.medium,
    lineHeight: theme.font.lineHeight.normal,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: `background ${theme.transition.fast}, color ${theme.transition.fast}, box-shadow ${theme.transition.fast}, opacity ${theme.transition.fast}`,
    opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
    outline: 'none',
    ...sizeStyles[size],
  };

  const variants: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      background: hovered && !disabled
        ? theme.color.primary.hover
        : theme.color.primary.DEFAULT,
      color: theme.color.text.inverse,
      boxShadow: focused ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.primary.DEFAULT}` : 'none',
    },
    secondary: {
      background: hovered && !disabled
        ? theme.color.primary.muted
        : 'transparent',
      color: theme.color.primary.DEFAULT,
      boxShadow: focused
        ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.primary.DEFAULT}`
        : `inset 0 0 0 1px ${theme.color.border.DEFAULT}`,
    },
    ghost: {
      background: hovered && !disabled
        ? theme.color.primary.subtle
        : 'transparent',
      color: hovered && !disabled
        ? theme.color.primary.DEFAULT
        : theme.color.text.DEFAULT,
      boxShadow: focused ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.primary.DEFAULT}` : 'none',
    },
    accent: {
      background: hovered && !disabled
        ? theme.color.accent.hover
        : theme.color.accent.DEFAULT,
      color: theme.color.text.inverse,
      boxShadow: focused ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.accent.DEFAULT}` : 'none',
    },
  };

  return (
    <button
      disabled={disabled}
      style={{ ...base, ...variants[variant], ...style }}
      {...handlers}
      {...rest}
    >
      {children}
    </button>
  );
}
