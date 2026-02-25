import { Text } from 'ink';
import React from 'react';

import { cliTheme } from './theme.js';

export type CliStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

const ICONS: Record<CliStatus, { icon: string; color: string }> = {
  pending: { icon: '·', color: cliTheme.color.muted },
  running: { icon: '…', color: cliTheme.color.primary },
  done: { icon: '✓', color: cliTheme.color.success },
  skipped: { icon: '↩', color: cliTheme.color.muted },
  error: { icon: '✗', color: cliTheme.color.error },
};

export function CliStatusLine({
  label,
  status,
  detail,
}: {
  label: string;
  status: CliStatus;
  detail?: string;
}) {
  const { icon, color } = ICONS[status];
  return (
    <Text>
      {'  '}
      <Text color={color}>{icon}</Text>
      {'  '}
      <Text color={cliTheme.color.text}>{label.padEnd(38)}</Text>
      {detail && <Text color={cliTheme.color.accent}>{detail}</Text>}
    </Text>
  );
}
