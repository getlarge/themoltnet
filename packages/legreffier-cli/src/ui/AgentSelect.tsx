import { cliTheme } from '@themoltnet/design-system/cli';
import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';

import { type AgentType, SUPPORTED_AGENTS } from './types.js';

interface AgentOption {
  id: string;
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
    id: 'codex',
    label: 'Codex',
    description: '.codex/config.toml + .agents/skills/ + /legreffier skill',
    available: true,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    description: 'coming soon',
    available: false,
  },
];

interface AgentSelectProps {
  onSelect: (agents: AgentType[]) => void;
}

export function AgentSelect({ onSelect }: AgentSelectProps) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<AgentType>>(new Set());

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((i) => (i > 0 ? i - 1 : i));
    } else if (key.downArrow) {
      setCursor((i) => (i < AGENTS.length - 1 ? i + 1 : i));
    } else if (input === ' ') {
      const agent = AGENTS[cursor];
      if (
        agent?.available &&
        SUPPORTED_AGENTS.includes(agent.id as AgentType)
      ) {
        setSelected((prev) => {
          const next = new Set(prev);
          const id = agent.id as AgentType;
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
      }
    } else if (key.return && selected.size > 0) {
      onSelect(Array.from(selected));
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
          Select your AI coding agent(s)
        </Text>
        <Text> </Text>
        {AGENTS.map((agent, i) => {
          const isCurrent = i === cursor;
          const isSelected = selected.has(agent.id as AgentType);
          const checkbox = agent.available
            ? isSelected
              ? '[*] '
              : '[ ] '
            : '    ';
          const prefix = isCurrent ? '> ' : '  ';
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
                {prefix + checkbox + agent.label}
              </Text>
              <Text color={cliTheme.color.muted}>
                {'  ' + agent.description}
              </Text>
            </Box>
          );
        })}
        <Text> </Text>
        <Text color={cliTheme.color.muted}>
          {'  \u2191\u2193 navigate, Space toggle, Enter confirm'}
        </Text>
      </Box>
    </Box>
  );
}
