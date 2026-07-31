import type { ReactNode } from 'react';

import { useTheme } from '../hooks.js';
import { Stack } from './stack.js';
import { Text } from './text.js';

export interface PageHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  backLink?: ReactNode;
  id?: string;
}

export function PageHeader({
  title,
  eyebrow,
  description,
  metadata,
  actions,
  backLink,
  id,
}: PageHeaderProps) {
  const theme = useTheme();

  return (
    <header>
      <Stack gap={3}>
        {backLink}
        <Stack
          direction="row"
          justify="space-between"
          align="flex-start"
          gap={5}
          wrap
        >
          <Stack gap={2} style={{ minWidth: 0, maxWidth: '48rem' }}>
            {eyebrow ? (
              <Text variant="overline" color="primary">
                {eyebrow}
              </Text>
            ) : null}
            <Text id={id} variant="h1">
              {title}
            </Text>
            {description ? (
              <Text
                color="secondary"
                style={{
                  maxWidth: '70ch',
                  lineHeight: theme.font.lineHeight.relaxed,
                }}
              >
                {description}
              </Text>
            ) : null}
            {metadata}
          </Stack>
          {actions ? (
            <div style={{ flex: '0 0 auto', paddingTop: theme.spacing[1] }}>
              {actions}
            </div>
          ) : null}
        </Stack>
      </Stack>
    </header>
  );
}
