import type { ReactNode } from 'react';

import { useTheme } from '../hooks.js';
import { ControlSurface } from './control-surface.js';
import { Stack } from './stack.js';
import { Text } from './text.js';

export interface EmptyStateProps {
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  compact = false,
}: EmptyStateProps) {
  const theme = useTheme();
  return (
    <ControlSurface padding={compact ? 'sm' : 'lg'}>
      <Stack gap={compact ? 2 : 4} align="flex-start">
        {icon ? (
          <span
            aria-hidden="true"
            style={{ color: theme.color.text.muted, display: 'inline-flex' }}
          >
            {icon}
          </span>
        ) : null}
        <Stack gap={2}>
          <Text variant={compact ? 'h4' : 'h3'}>{title}</Text>
          <Text color="secondary" style={{ maxWidth: '60ch' }}>
            {description}
          </Text>
        </Stack>
        {action}
      </Stack>
    </ControlSurface>
  );
}
