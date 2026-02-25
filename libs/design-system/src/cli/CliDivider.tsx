import { Text } from 'ink';
import React from 'react';

import { cliTheme } from './theme.js';

export function CliDivider() {
  return (
    <Text color={cliTheme.color.primary}>
      {'  ══════════════════════════════════════════════════'}
    </Text>
  );
}
