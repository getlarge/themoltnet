import type { ReactNode } from 'react';

import { useTheme } from '../hooks.js';

export interface DescriptionListItem {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
}

export interface DescriptionListProps {
  items: DescriptionListItem[];
  columns?: 1 | 2 | 3 | 4;
  compact?: boolean;
  ariaLabel?: string;
}

export function DescriptionList({
  items,
  columns = 2,
  compact = false,
  ariaLabel,
}: DescriptionListProps) {
  const theme = useTheme();
  const minimumWidth = { 1: '100%', 2: '14rem', 3: '11rem', 4: '9rem' }[
    columns
  ];

  return (
    <dl
      aria-label={ariaLabel}
      style={{
        display: 'grid',
        gridTemplateColumns:
          columns === 1
            ? 'minmax(0, 1fr)'
            : `repeat(auto-fit, minmax(min(100%, ${minimumWidth}), 1fr))`,
        gap: compact ? theme.spacing[2] : theme.spacing[4],
        margin: 0,
      }}
    >
      {items.map((item, index) => (
        <div key={index} style={{ minWidth: 0 }}>
          <dt
            style={{
              color: theme.color.text.muted,
              fontSize: theme.font.size.xs,
              lineHeight: theme.font.lineHeight.normal,
              margin: 0,
            }}
          >
            {item.label}
          </dt>
          <dd
            style={{
              color: theme.color.text.DEFAULT,
              fontFamily: item.mono ? theme.font.family.mono : undefined,
              fontSize: compact ? theme.font.size.sm : theme.font.size.md,
              lineHeight: theme.font.lineHeight.normal,
              margin: `${theme.spacing[1]} 0 0`,
              minWidth: 0,
              overflowWrap: 'anywhere',
            }}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
