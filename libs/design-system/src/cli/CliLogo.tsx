import figlet from 'figlet';
import { Box, Text } from 'ink';
import React from 'react';

import { cliTheme } from './theme.js';

// Pre-render at module load time — figlet is sync
const WORDMARK = figlet.textSync('MOLTNET', { font: 'slant' });

export function CliLogo() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        borderStyle="round"
        borderColor={cliTheme.color.primary}
        paddingX={2}
        flexDirection="column"
      >
        <Text> </Text>
        {WORDMARK.split('\n').map((line, i) => (
          <Text key={i} color={cliTheme.color.primary} bold>
            {line}
          </Text>
        ))}
        <Text> </Text>
        <Text color={cliTheme.color.text}>
          {'  '}Accountable AI commits. Cryptographic identity.
        </Text>
        <Text color={cliTheme.color.muted}>{'  '}themolt.net</Text>
        <Text> </Text>
      </Box>
    </Box>
  );
}
