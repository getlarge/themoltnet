import { cliTheme } from '@moltnet/design-system/cli';
import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';

import type { AgentType } from './types.js';

interface AgentOption {
  id: AgentType | string;
  label: string;
  description: string;
  available: boolean;
}

const AGENTS: AgentOption[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    description: 'settings.local.json + .mcp.json + /legreffier skill',
    available: true,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    description: 'coming soon',
    available: false,
  },
  {
    id: 'codex',
    label: 'Codex',
    description: 'coming soon',
    available: false,
  },
];

interface AgentSelectProps {
  onSelect: (agent: AgentType) => void;
}

export function AgentSelect({ onSelect }: AgentSelectProps) {
  const [selected, setSelected] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelected((i) => (i > 0 ? i - 1 : i));
    } else if (key.downArrow) {
      setSelected((i) => (i < AGENTS.length - 1 ? i + 1 : i));
    } else if (key.return) {
      const agent = AGENTS[selected];
      if (agent && agent.available) {
        onSelect(agent.id as AgentType);
      }
    }
  });

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        borderStyle="round"
        borderColor={cliTheme.color.primary}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
      >
        <Text color={cliTheme.color.primary} bold>
          Select your AI coding agent
        </Text>
        <Text> </Text>
        {AGENTS.map((agent, i) => {
          const isCurrent = i === selected;
          const prefix = isCurrent ? '▸ ' : '  ';
          return (
            <Box key={agent.id}>
              <Text
                color={
                  !agent.available
                    ? cliTheme.color.muted
                    : isCurrent
                      ? cliTheme.color.accent
                      : cliTheme.color.text
                }
                bold={isCurrent && agent.available}
              >
                {prefix + agent.label}
              </Text>
              <Text color={cliTheme.color.muted}>
                {'  ' + agent.description}
              </Text>
            </Box>
          );
        })}
        <Text> </Text>
        <Text color={cliTheme.color.muted}>
          {'  ↑↓ to navigate, Enter to select'}
        </Text>
      </Box>
    </Box>
  );
}
