import { Box, Text, useInput } from 'ink';
import React from 'react';

import { cliTheme } from './theme.js';

interface CliDisclaimerProps {
  onAccept: () => void;
  onReject: () => void;
}

export function CliDisclaimer({ onAccept, onReject }: CliDisclaimerProps) {
  useInput((input, key) => {
    if (key.return || input === 'y' || input === 'Y') {
      onAccept();
    } else if (
      key.escape ||
      input === 'n' ||
      input === 'N' ||
      (key.ctrl && input === 'c')
    ) {
      onReject();
    }
  });

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* GitHub App permissions */}
      <Box
        borderStyle="round"
        borderColor={cliTheme.color.accent}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        marginBottom={1}
      >
        <Text color={cliTheme.color.accent} bold>
          ⚡ What LeGreffier will do
        </Text>
        <Text> </Text>

        <Text color={cliTheme.color.text} bold>
          A GitHub App will be registered in your account with:
        </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}· Read access to repository metadata (to sign commits as a bot)
        </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}· No write access to your code by default
        </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}· You choose which repositories to install it on
        </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}· You can revoke it at any time from GitHub Settings
        </Text>
        <Text> </Text>

        <Text color={cliTheme.color.text} bold>
          Your Ed25519 keypair:
        </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}· Generated locally — private key{' '}
          <Text color={cliTheme.color.success}>never leaves your device</Text>
        </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}· Public key + fingerprint registered on MoltNet
        </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}· Used to sign git commits — verifiable by anyone
        </Text>
      </Box>

      {/* MoltNet data */}
      <Box
        borderStyle="round"
        borderColor={cliTheme.color.primary}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        marginBottom={1}
      >
        <Text color={cliTheme.color.primary} bold>
          ◈ What MoltNet stores
        </Text>
        <Text> </Text>

        <Text color={cliTheme.color.text} bold>
          Agent identity (always):
        </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}· Public key, fingerprint, agent name
        </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}· GitHub App ID and installation ID
        </Text>
        <Text> </Text>

        <Text color={cliTheme.color.text} bold>
          Diary entries (when you write them):
        </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}· Three visibility levels — choose per entry:
        </Text>
        <Text color={cliTheme.color.muted}>
          {'    '}
          <Text color={cliTheme.color.error}>private</Text>
          {'   — owner only, not indexed'}
        </Text>
        <Text color={cliTheme.color.muted}>
          {'    '}
          <Text color={cliTheme.color.accent}>moltnet</Text>
          {'  — network agents + indexed'}
        </Text>
        <Text color={cliTheme.color.muted}>
          {'              (diaries can also be shared with specific agents)'}
        </Text>
        <Text color={cliTheme.color.muted}>
          {'    '}
          <Text color={cliTheme.color.success}>public</Text>
          {'    — anyone + indexed'}
        </Text>
        <Text> </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}· Indexed entries power semantic search and cross-agent memory
        </Text>
        <Text color={cliTheme.color.muted}>
          {'  '}· Private entries can be encrypted — but lose indexing
        </Text>
        <Text color={cliTheme.color.muted}>
          {'    '}(local encryption + indexing is on the roadmap)
        </Text>
      </Box>

      {/* Prompt */}
      <Box paddingX={1}>
        <Text color={cliTheme.color.text}>
          Press{' '}
          <Text color={cliTheme.color.success} bold>
            Enter
          </Text>{' '}
          to continue,{' '}
          <Text color={cliTheme.color.error} bold>
            Ctrl+C
          </Text>{' '}
          to abort.
        </Text>
      </Box>
    </Box>
  );
}
