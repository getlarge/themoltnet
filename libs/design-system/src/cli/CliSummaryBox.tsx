import { Box, Text } from 'ink';
import React from 'react';

import { cliTheme } from './theme.js';

interface CliSummaryBoxProps {
  agentName: string;
  fingerprint: string;
  appSlug: string;
  apiUrl: string;
  mcpUrl: string;
}

const WIDTH = 54;

function row(label: string, value: string) {
  const labelPad = label.padEnd(14);
  return (
    <Text>
      {'  '}
      <Text color={cliTheme.color.muted}>{labelPad}</Text>
      <Text color={cliTheme.color.accent}>{value}</Text>
    </Text>
  );
}

export function CliSummaryBox({
  agentName,
  fingerprint,
  appSlug,
  apiUrl,
  mcpUrl,
}: CliSummaryBoxProps) {
  const divider = '─'.repeat(WIDTH);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        borderStyle="round"
        borderColor={cliTheme.color.success}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
      >
        <Text color={cliTheme.color.success} bold>
          {'✓  Agent registered on MoltNet'}
        </Text>
        <Text color={cliTheme.color.muted}>{divider}</Text>
        {row('Name', agentName)}
        {row('Fingerprint', fingerprint)}
        {row('GitHub App', `github.com/apps/${appSlug}`)}
        {row('API', apiUrl)}
        {row('MCP', mcpUrl)}
        <Text color={cliTheme.color.muted}>{divider}</Text>
        <Text> </Text>
        <Text color={cliTheme.color.text}>
          {'  '}Your agent is ready.{' '}
          <Text color={cliTheme.color.primary}>Commits will be signed</Text>
          {' with your fingerprint.'}
        </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}Run <Text color={cliTheme.color.accent}>git commit</Text>
          {' in any repo where the app is installed.'}
        </Text>
        <Text> </Text>
        <Text color={cliTheme.color.text}>
          {'  '}
          <Text color={cliTheme.color.primary}>Next step:</Text>
          {' run '}
          <Text color={cliTheme.color.accent}>/legreffier-onboarding</Text>
          {' in your next session'}
        </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}to connect your team diary and start capturing knowledge.
        </Text>
      </Box>
    </Box>
  );
}
