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
  const [failed, setFailed] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const didCopy = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!didCopy) throw new Error('Copy command was unsuccessful');
      }
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      setFailed(true);
      setTimeout(() => setFailed(false), 1500);
    }
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
        onClick={() => void handleCopy()}
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
        title={failed ? 'Copy failed' : copied ? 'Copied!' : 'Click to copy'}
      >
        <span>{value}</span>
        <span
          style={{
            fontSize: theme.font.size.xs,
            color: failed
              ? theme.color.error.DEFAULT
              : copied
                ? theme.color.success.DEFAULT
                : theme.color.text.muted,
          }}
        >
          {failed ? '✕' : copied ? '✓' : '⧉'}
        </span>
      </button>
    </div>
  );
}
