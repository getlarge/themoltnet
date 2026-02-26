import { Box, Text } from 'ink';

import { cliTheme } from './theme.js';

export function CliStepHeader({
  n,
  total,
  label,
}: {
  n: number;
  total: number;
  label: string;
}) {
  const fill = '─'.repeat(Math.max(2, 48 - label.length));
  return (
    <Box marginTop={1}>
      <Text color={cliTheme.color.primary}>
        {`── ${n} / ${total}  ${label} ${fill}`}
      </Text>
    </Box>
  );
}
