import type { ButtonHTMLAttributes } from 'react';

import { useInteractive, useReducedMotion, useTheme } from '../hooks.js';
import type { Size } from '../types.js';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'accent'
  | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: Size;
  loading?: boolean;
  loadingLabel?: string;
}

// Interactive controls meet the WCAG 2.5.5 minimum touch target (44x44px);
// padding sets the visual size, minHeight guarantees the hit area.
const sizeStyles: Record<Size, React.CSSProperties> = {
  sm: { padding: '0.375rem 0.75rem', fontSize: '0.875rem', minHeight: '44px' },
  md: { padding: '0.5rem 1rem', fontSize: '1rem', minHeight: '44px' },
  lg: { padding: '0.625rem 1.5rem', fontSize: '1.125rem', minHeight: '48px' },
};

/**
 * Inline loading indicator. Spins when motion is allowed; renders a static
 * partial ring otherwise so the "working" state stays visible under
 * prefers-reduced-motion. Marked aria-hidden — the button carries aria-busy.
 */
function Spinner({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={
        reducedMotion
          ? undefined
          : { animation: 'molt-spin 0.7s linear infinite' }
      }
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeOpacity="0.25"
      />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled,
  loading,
  loadingLabel,
  style,
  children,
  'aria-busy': ariaBusy,
  'aria-label': ariaLabel,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const { hovered, focused, pressed, handlers } = useInteractive();
  const isDisabled = disabled || loading;

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
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    transition: `background ${theme.transition.fast}, color ${theme.transition.fast}, box-shadow ${theme.transition.fast}, opacity ${theme.transition.fast}`,
    opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
    outline: 'none',
    ...sizeStyles[size],
  };

  const variants: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      background:
        hovered && !disabled
          ? theme.color.primary.hover
          : theme.color.primary.DEFAULT,
      color: theme.color.text.inverse,
      boxShadow: focused
        ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.primary.DEFAULT}`
        : 'none',
    },
    secondary: {
      background:
        hovered && !disabled ? theme.color.primary.muted : 'transparent',
      color: theme.color.primary.DEFAULT,
      boxShadow: focused
        ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.primary.DEFAULT}`
        : `inset 0 0 0 1px ${theme.color.border.DEFAULT}`,
    },
    ghost: {
      background:
        hovered && !disabled ? theme.color.primary.subtle : 'transparent',
      color:
        hovered && !disabled
          ? theme.color.primary.DEFAULT
          : theme.color.text.DEFAULT,
      boxShadow: focused
        ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.primary.DEFAULT}`
        : 'none',
    },
    accent: {
      background:
        hovered && !disabled
          ? theme.color.accent.hover
          : theme.color.accent.DEFAULT,
      color: theme.color.text.inverse,
      boxShadow: focused
        ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.accent.DEFAULT}`
        : 'none',
    },
    // Danger owns the error token so destructive actions never borrow the
    // amber identity hue. Amber stays reserved for Ed25519 identity. Error has
    // no `.hover` token, so hover darkens via an inset overlay instead.
    danger: {
      background: theme.color.error.DEFAULT,
      color: theme.color.text.inverse,
      boxShadow: focused
        ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${theme.color.error.DEFAULT}`
        : hovered && !disabled
          ? 'inset 0 0 0 999px rgba(0, 0, 0, 0.12)'
          : 'none',
    },
  };

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={ariaBusy ?? (loading ? true : undefined)}
      aria-label={loading && loadingLabel ? loadingLabel : ariaLabel}
      style={{ ...base, ...variants[variant], ...style }}
      {...handlers}
      {...rest}
    >
      {loading && <Spinner reducedMotion={reducedMotion} />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}
