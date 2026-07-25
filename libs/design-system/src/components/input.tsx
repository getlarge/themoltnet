import type { InputHTMLAttributes } from 'react';
import { useId } from 'react';

import { useInteractive, useTheme } from '../hooks.js';
import type { Size } from '../types.js';

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size'
> {
  label?: string;
  hint?: string;
  error?: string;
  /**
   * Control size. Named `size` to match Button and the rest of the system;
   * the native `<input size>` attribute is intentionally shadowed (rarely used
   * and pixel-width semantics don't fit the design scale).
   */
  size?: Size;
}

const sizeStyles: Record<Size, React.CSSProperties> = {
  sm: { padding: '0.375rem 0.5rem', fontSize: '0.875rem' },
  md: { padding: '0.5rem 0.75rem', fontSize: '1rem' },
  lg: { padding: '0.625rem 1rem', fontSize: '1.125rem' },
};

export function Input({
  label,
  hint,
  error,
  size = 'md',
  disabled,
  style,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...rest
}: InputProps) {
  const theme = useTheme();
  const { focused, hovered, handlers } = useInteractive();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  // Describe by BOTH hint and error so guidance survives an error state.
  const describedBy = [ariaDescribedBy, hintId, errorId]
    .filter(Boolean)
    .join(' ');

  const borderColor = error
    ? theme.color.error.DEFAULT
    : focused
      ? theme.color.border.focus
      : hovered && !disabled
        ? theme.color.border.hover
        : theme.color.border.DEFAULT;

  const inputStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    background: theme.color.bg.surface,
    color: theme.color.text.DEFAULT,
    border: `1px solid ${borderColor}`,
    borderRadius: theme.radius.md,
    fontFamily: 'inherit',
    lineHeight: theme.font.lineHeight.normal,
    outline: 'none',
    transition: `border-color ${theme.transition.fast}, box-shadow ${theme.transition.fast}`,
    // Signature dual-ring focus (void-separated), matching Button and Card.
    // Error tints the ring red; otherwise it's the primary teal.
    boxShadow: focused
      ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${
          error ? theme.color.error.DEFAULT : theme.color.border.focus
        }`
      : 'none',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'text',
    ...sizeStyles[size],
    ...style,
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: theme.spacing[1],
    fontSize: theme.font.size.sm,
    fontWeight: theme.font.weight.medium,
    color: theme.color.text.DEFAULT,
  };

  const hintStyle: React.CSSProperties = {
    display: 'block',
    marginTop: theme.spacing[1],
    fontSize: theme.font.size.xs,
    color: theme.color.text.muted,
  };

  const errorStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
    fontSize: theme.font.size.xs,
    color: theme.color.error.DEFAULT,
  };

  return (
    <div>
      {label && (
        <label htmlFor={inputId} style={labelStyle}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        disabled={disabled}
        aria-describedby={describedBy || undefined}
        aria-invalid={ariaInvalid ?? (error ? true : undefined)}
        style={inputStyle}
        {...handlers}
        {...rest}
      />
      {hint && (
        <span id={hintId} style={hintStyle}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} style={errorStyle}>
          {/* Glyph so the error isn't signalled by color alone (WCAG 1.4.1). */}
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </span>
      )}
    </div>
  );
}
