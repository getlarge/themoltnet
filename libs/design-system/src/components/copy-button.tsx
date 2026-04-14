import { useCallback, useState } from 'react';

import { useTheme } from '../hooks.js';
import type { Size } from '../types.js';

export interface CopyButtonProps {
  value: string;
  label?: string;
  size?: Size;
}

export function CopyButton({ value, label, size = 'md' }: CopyButtonProps) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);

  const fontSize =
    size === 'sm'
      ? theme.font.size.xs
      : size === 'lg'
        ? theme.font.size.md
        : theme.font.size.sm;

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: theme.spacing[1],
      }}
    >
      {label && (
        <span
          style={{
            fontSize: theme.font.size.xs,
            color: theme.color.text.muted,
            textTransform: 'uppercase',
            letterSpacing: theme.font.letterSpacing.wide,
            fontWeight: theme.font.weight.medium,
          }}
        >
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={handleCopy}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: theme.spacing[2],
          padding: `${theme.spacing[1]} ${theme.spacing[2]}`,
          background: theme.color.bg.overlay,
          border: `1px solid ${theme.color.border.DEFAULT}`,
          borderRadius: theme.radius.sm,
          color: theme.color.text.DEFAULT,
          fontFamily: theme.font.family.mono,
          fontSize,
          cursor: 'pointer',
          transition: theme.transition.fast,
          userSelect: 'all' as const,
        }}
        title={copied ? 'Copied!' : 'Click to copy'}
      >
        <span>{value}</span>
        <span
          style={{
            fontSize: theme.font.size.xs,
            color: copied
              ? theme.color.success.DEFAULT
              : theme.color.text.muted,
          }}
        >
          {copied ? '✓' : '⧉'}
        </span>
      </button>
    </div>
  );
}
