import { Box, Text } from 'ink';
import React, { useEffect, useState } from 'react';

import { cliTheme } from './theme.js';

// Quill — vertical, compact, left-aligned
const QUILL_LINES = [
  '  ╲░▒▓▒░  ╲░▒▓▒░  ╲░▒▓',
  '   ╲▓▒░    ╲▓▒░    ╲▓▒',
  '    ╲░      ╲░      ╲░',
  '     ╲───────╲───────╲',
  '                       ◆',
];

const WORDMARK = [
  ' __  __  ___  _  _____  _  _ ___ _____',
  '|  \\/  |/ _ \\| ||_   _|| \\| | __|_   _|',
  '| |\\/| | (_) | |__| |  | .` | _|  | |  ',
  '|_|  |_|\\___/|____|_|  |_|\\_|___| |_|  ',
];

// Halo ring — wraps around wordmark
const HALO_TOP =
  '   ·  ·  ╭──────────────────────────────────────────────╮  ·  ·';
const HALO_BOT =
  '   ·  ·  ╰──────────────────────────────────────────────╯  ·  ·';

// Animated halo shimmer — cycles through teal brightness
const SHIMMER = [
  '·  ·  ○  ·  ·  ○  ·  ·  ○  ·  ·  ○  ·  ·  ○  ·  ·  ○  ·',
  '○  ·  ·  ○  ·  ·  ○  ·  ·  ○  ·  ·  ○  ·  ·  ○  ·  ·  ○  ',
  '·  ○  ·  ·  ○  ·  ·  ○  ·  ·  ○  ·  ·  ○  ·  ·  ○  ·  ·  ',
];

const GLOW_COLORS = [cliTheme.color.primary, '#00e8dc', '#00f0e2', '#00e8dc'];

export function CliHero({ animated = false }: { animated?: boolean }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!animated) return;
    const t = setInterval(() => setTick((n) => n + 1), 800);
    return () => clearInterval(t);
  }, [animated]);

  const glowColor = GLOW_COLORS[tick % GLOW_COLORS.length];
  const shimmer = SHIMMER[tick % SHIMMER.length];

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        borderStyle="round"
        borderColor={cliTheme.color.primary}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
      >
        {/* Quill feathers */}
        {QUILL_LINES.map((line, i) => (
          <Text
            key={'q' + i}
            color={
              i < 3
                ? cliTheme.color.accent
                : i === 3
                  ? '#c08010'
                  : cliTheme.color.text
            }
          >
            {line}
          </Text>
        ))}

        <Text> </Text>

        {/* Halo top */}
        <Text color={glowColor}>{HALO_TOP}</Text>

        {/* Wordmark inside halo */}
        {WORDMARK.map((line, i) => (
          <Text key={'w' + i}>
            <Text color={glowColor}>{'   ·  ·  │  '}</Text>
            <Text color={cliTheme.color.primary} bold>
              {line.padEnd(42)}
            </Text>
            <Text color={glowColor}>{'  │  ·  ·'}</Text>
          </Text>
        ))}

        {/* Shimmer line inside halo */}
        <Text>
          <Text color={glowColor}>{'   ·  ·  │  '}</Text>
          <Text color={glowColor}>{shimmer.slice(0, 42).padEnd(42)}</Text>
          <Text color={glowColor}>{'  │  ·  ·'}</Text>
        </Text>

        {/* Halo bottom */}
        <Text color={glowColor}>{HALO_BOT}</Text>

        <Text> </Text>

        {/* Tagline */}
        <Text>
          {'  '}
          <Text color={cliTheme.color.text}>Accountable AI commits. </Text>
          <Text color={cliTheme.color.accent} bold>
            Cryptographic identity.
          </Text>
        </Text>
        <Text>
          {'  '}
          <Text color={cliTheme.color.muted}>themolt.net </Text>
          <Text color={cliTheme.color.primary}>· LeGreffier ·</Text>
        </Text>
      </Box>
    </Box>
  );
}
