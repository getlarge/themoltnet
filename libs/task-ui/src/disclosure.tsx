import { useTheme } from '@themoltnet/design-system';
import { type ReactNode, useState } from 'react';

export interface DisclosureProps {
  summary: ReactNode;
  /** Secondary text after the summary label, e.g. what the section holds. */
  hint?: ReactNode;
  children: ReactNode;
}

/**
 * Progressive disclosure built on native `<details>`, so keyboard, screen
 * reader, and find-in-page behaviour come from the browser.
 */
export function Disclosure({ summary, hint, children }: DisclosureProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: `0 ${theme.spacing[2]}`,
          minHeight: '2.75rem',
          cursor: 'pointer',
          listStyle: 'none',
          color: theme.color.text.DEFAULT,
          fontSize: theme.font.size.sm,
          fontWeight: theme.font.weight.medium,
          borderRadius: theme.radius.sm,
        }}
      >
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          style={{
            flexShrink: 0,
            color: theme.color.text.muted,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: `transform ${theme.transition.fast}`,
          }}
        >
          <path
            d="M4.5 2.5 8 6l-3.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>{summary}</span>
        {hint ? (
          <span
            style={{
              color: theme.color.text.muted,
              fontWeight: theme.font.weight.normal,
            }}
          >
            {hint}
          </span>
        ) : null}
      </summary>
      <div style={{ paddingTop: theme.spacing[2] }}>{children}</div>
    </details>
  );
}
