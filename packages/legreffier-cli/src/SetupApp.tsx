import { join } from 'node:path';

import {
  CliHero,
  CliSpinner,
  CliSummaryBox,
  cliTheme,
} from '@moltnet/design-system/cli';
import { readConfig } from '@themoltnet/sdk';
import { Box, Text, useApp } from 'ink';
import React, { useEffect, useState } from 'react';

import { adapters } from './adapters/index.js';
import type { AgentAdapterOptions } from './adapters/types.js';
import { toEnvPrefix } from './setup.js';
import { AgentSelect } from './ui/AgentSelect.js';
import type { UISummary } from './ui/types.js';
import type { AgentType } from './ui/types.js';

export interface SetupAppProps {
  name: string;
  agents: AgentType[];
  apiUrl: string;
  dir: string;
}

type SetupPhase = 'agent_select' | 'running' | 'done' | 'error';

export function SetupApp({
  name,
  agents: agentsProp,
  apiUrl,
  dir,
}: SetupAppProps) {
  const { exit } = useApp();

  const [phase, setPhase] = useState<SetupPhase>(
    agentsProp.length > 0 ? 'running' : 'agent_select',
  );
  const [agents, setAgents] = useState<AgentType[]>(agentsProp);
  const [error, setError] = useState<string>();
  const [filesWritten, setFilesWritten] = useState<string[]>([]);
  const [summary, setSummary] = useState<UISummary | null>(null);

  useEffect(() => {
    if (phase !== 'running' || agents.length === 0) return;

    void (async () => {
      try {
        const configDir = join(dir, '.moltnet', name);
        const config = await readConfig(configDir);
        if (!config) {
          throw new Error(
            `Config not found at ${configDir}/moltnet.json. Run "legreffier init" first.`,
          );
        }

        const prefix = toEnvPrefix(name);
        const mcpUrl =
          config.endpoints?.mcp ??
          apiUrl.replace('://api.', '://mcp.') + '/mcp';
        const opts: AgentAdapterOptions = {
          repoDir: dir,
          agentName: name,
          prefix,
          mcpUrl,
          clientId: config.oauth2.client_id,
          clientSecret: config.oauth2.client_secret,
          appSlug: config.github?.app_slug ?? config.github?.app_id ?? '',
          pemPath: config.github?.private_key_path ?? '',
          installationId: config.github?.installation_id ?? '',
        };

        const written: string[] = [];
        for (const agentType of agents) {
          const adapter = adapters[agentType];
          await adapter.writeMcpConfig(opts);
          written.push(`${agentType}: MCP config`);
          await adapter.writeSkills(dir);
          written.push(`${agentType}: skills`);
          await adapter.writeSettings(opts);
          written.push(`${agentType}: settings`);
        }

        setFilesWritten(written);
        setSummary({
          agentName: name,
          fingerprint: config.keys?.fingerprint ?? '',
          appSlug: config.github?.app_slug ?? config.github?.app_id ?? '',
          apiUrl: config.endpoints?.api ?? apiUrl,
          mcpUrl,
        });
        setPhase('done');
        setTimeout(() => exit(), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    })();
  }, [phase, agents]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'agent_select') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <CliHero />
        <AgentSelect
          onSelect={(selected) => {
            setAgents(selected);
            setPhase('running');
          }}
        />
      </Box>
    );
  }

  if (phase === 'running') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <CliHero />
        <CliSpinner label={`Configuring ${agents.join(', ')} for ${name}...`} />
      </Box>
    );
  }

  if (phase === 'error') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <CliHero />
        <Box
          borderStyle="round"
          borderColor={cliTheme.color.error}
          paddingX={2}
          paddingY={1}
        >
          <Text color={cliTheme.color.error} bold>
            {'* Setup failed: ' + (error ?? 'unknown error')}
          </Text>
        </Box>
      </Box>
    );
  }

  // done
  return (
    <Box flexDirection="column" paddingY={1}>
      <CliHero />
      <Box flexDirection="column" marginBottom={1}>
        <Text color={cliTheme.color.success} bold>
          Agent setup complete!
        </Text>
        {filesWritten.map((f, i) => (
          <Text key={i} color={cliTheme.color.muted}>
            {'  * ' + f}
          </Text>
        ))}
      </Box>
      {summary && (
        <CliSummaryBox
          agentName={summary.agentName}
          fingerprint={summary.fingerprint}
          appSlug={summary.appSlug}
          apiUrl={summary.apiUrl}
          mcpUrl={summary.mcpUrl}
        />
      )}
    </Box>
  );
}
