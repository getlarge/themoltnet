import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Agent } from '@themoltnet/sdk';
import { connect } from '@themoltnet/sdk/node';

interface MoltNetConfig {
  endpoints?: { api?: string };
}

export interface TasksApiContext {
  agentDir: string;
  apiUrl: string;
  agent: Agent;
  auth: () => Promise<string>;
}

export function resolveAgentDirectory(
  repoRoot: string,
  agentName: string,
  configuredAgentDir = process.env.MOLTNET_AGENT_DIR,
): string {
  return configuredAgentDir?.trim() || join(repoRoot, '.moltnet', agentName);
}

export async function resolveTasksApiContext(
  repoRoot: string,
  agentName: string,
  configuredAgentDir = process.env.MOLTNET_AGENT_DIR,
): Promise<TasksApiContext> {
  const agentDir = resolveAgentDirectory(
    repoRoot,
    agentName,
    configuredAgentDir,
  );
  const cfg = JSON.parse(
    readFileSync(join(agentDir, 'moltnet.json'), 'utf8'),
  ) as MoltNetConfig;
  const apiUrl = (cfg.endpoints?.api ?? 'https://api.themolt.net').replace(
    /\/$/,
    '',
  );
  const agent = await connect({ configDir: agentDir });

  return {
    agentDir,
    apiUrl,
    agent,
    auth: () => agent.getToken(),
  };
}
