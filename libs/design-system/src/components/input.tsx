import type { InputHTMLAttributes } from 'react';

import { useInteractive, useTheme } from '../hooks.js';
import type { Size } from '../types.js';

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size'
> {
  label?: string;
  hint?: string;
  error?: string;
  inputSize?: Size;
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
  inputSize = 'md',
  disabled,
  style,
  id,
  ...rest
}: InputProps) {
  const theme = useTheme();
  const { focused, hovered, handlers } = useInteractive();
  const inputId =
    id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

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
    boxShadow:
      focused && !error
        ? `0 0 0 3px ${theme.color.primary.muted}`
        : focused && error
          ? `0 0 0 3px ${theme.color.error.muted}`
          : 'none',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'text',
    ...sizeStyles[inputSize],
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
    color: error ? theme.color.error.DEFAULT : theme.color.text.muted,
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
        style={inputStyle}
        {...handlers}
        {...rest}
      />
      {(hint || error) && <span style={hintStyle}>{error ?? hint}</span>}
    </div>
  );
}
