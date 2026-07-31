import type { CSSProperties, SelectHTMLAttributes } from 'react';
import { useId } from 'react';

import { useInteractive, useTheme } from '../hooks.js';
import type { Size } from '../types.js';

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'size'
> {
  label?: string;
  hint?: string;
  error?: string;
  size?: Size;
}

const sizeStyles: Record<Size, CSSProperties> = {
  sm: { padding: '0.375rem 2rem 0.375rem 0.5rem', fontSize: '0.875rem' },
  md: { padding: '0.5rem 2.25rem 0.5rem 0.75rem', fontSize: '1rem' },
  lg: { padding: '0.625rem 2.5rem 0.625rem 1rem', fontSize: '1.125rem' },
};

export function Select({
  label,
  hint,
  error,
  size = 'md',
  disabled,
  id,
  style,
  children,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...rest
}: SelectProps) {
  const theme = useTheme();
  const { focused, hovered, handlers } = useInteractive();
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;
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

  return (
    <div>
      {label ? (
        <label
          htmlFor={selectId}
          style={{
            color: theme.color.text.DEFAULT,
            display: 'block',
            fontSize: theme.font.size.sm,
            fontWeight: theme.font.weight.medium,
            marginBottom: theme.spacing[1],
          }}
        >
          {label}
        </label>
      ) : null}
      <select
        id={selectId}
        disabled={disabled}
        aria-describedby={describedBy || undefined}
        aria-invalid={ariaInvalid ?? (error ? true : undefined)}
        style={{
          appearance: 'none',
          background: `${theme.color.bg.surface} linear-gradient(45deg, transparent 50%, ${theme.color.text.secondary} 50%) calc(100% - 0.9rem) calc(50% - 0.1rem) / 0.35rem 0.35rem no-repeat`,
          border: `1px solid ${borderColor}`,
          borderRadius: theme.radius.md,
          boxShadow: focused
            ? `0 0 0 2px ${theme.color.bg.void}, 0 0 0 4px ${
                error ? theme.color.error.DEFAULT : theme.color.border.focus
              }`
            : 'none',
          color: theme.color.text.DEFAULT,
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'block',
          fontFamily: 'inherit',
          lineHeight: theme.font.lineHeight.normal,
          opacity: disabled ? 0.5 : 1,
          outline: 'none',
          transition: `border-color ${theme.transition.fast}, box-shadow ${theme.transition.fast}`,
          width: '100%',
          ...sizeStyles[size],
          ...style,
        }}
        {...handlers}
        {...rest}
      >
        {children}
      </select>
      {hint ? (
        <span
          id={hintId}
          style={{
            color: theme.color.text.muted,
            display: 'block',
            fontSize: theme.font.size.xs,
            marginTop: theme.spacing[1],
          }}
        >
          {hint}
        </span>
      ) : null}
      {error ? (
        <span
          id={errorId}
          style={{
            color: theme.color.error.DEFAULT,
            display: 'flex',
            fontSize: theme.font.size.xs,
            gap: theme.spacing[1],
            marginTop: theme.spacing[1],
          }}
        >
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </span>
      ) : null}
    </div>
  );
}
