import type { ReactNode } from 'react';

import { useTheme } from '../hooks.js';
import type { Signal } from '../types.js';
import { Stack } from './stack.js';
import { Text } from './text.js';

export interface InlineNoticeProps {
  tone?: Signal;
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}

export function InlineNotice({
  tone = 'info',
  title,
  children,
  action,
}: InlineNoticeProps) {
  const theme = useTheme();
  const signal = theme.color[tone];
  const glyph = { error: '×', warning: '!', success: '✓', info: 'i' }[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      style={{
        background: signal.muted,
        border: `1px solid ${signal.DEFAULT}`,
        borderRadius: theme.radius.md,
        color: theme.color.text.DEFAULT,
        padding: `${theme.spacing[3]} ${theme.spacing[4]}`,
      }}
    >
      <Stack direction="row" gap={3} align="flex-start">
        <span
          aria-hidden="true"
          style={{ color: signal.DEFAULT, fontWeight: theme.font.weight.bold }}
        >
          {glyph}
        </span>
        <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
          {title ? (
            <Text variant="caption" weight="semibold">
              {title}
            </Text>
          ) : null}
          <Text variant="caption" color="secondary">
            {children}
          </Text>
        </Stack>
        {action}
      </Stack>
    </div>
  );
}
