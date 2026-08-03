import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { McpConfig } from './register.js';

/** Environment variable credentials for MoltNet. */
export interface EnvCredentials {
  clientId?: string;
  clientSecret?: string;
  apiUrl?: string;
  agentKey?: string;
}

/** Read one environment value behind the SDK's config boundary. */
export function readEnvironmentVariable(name: string): string | undefined {
  return (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.[name];
}

/**
 * Read MoltNet credentials from environment variables.
 * Reads MOLTNET_CLIENT_ID, MOLTNET_CLIENT_SECRET, MOLTNET_API_URL, and
 * MOLTNET_AGENT_KEY.
 */
export function readEnvCredentials(): EnvCredentials {
  return {
    clientId: readEnvironmentVariable('MOLTNET_CLIENT_ID'),
    clientSecret: readEnvironmentVariable('MOLTNET_CLIENT_SECRET'),
    apiUrl: readEnvironmentVariable('MOLTNET_API_URL'),
    agentKey: readEnvironmentVariable('MOLTNET_AGENT_KEY'),
  };
}

export async function writeMcpConfig(
  mcpConfig: McpConfig,
  dir?: string,
): Promise<string> {
  const targetDir = dir ?? process.cwd();
  const filePath = join(targetDir, '.mcp.json');

  let existing: Record<string, unknown> = {};
  try {
    const content = await readFile(filePath, 'utf-8');
    existing = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // File doesn't exist — start fresh
  }

  const merged = {
    ...existing,
    mcpServers: {
      ...((existing.mcpServers as Record<string, unknown>) ?? {}),
      ...mcpConfig.mcpServers,
    },
  };

  await writeFile(filePath, JSON.stringify(merged, null, 2) + '\n');
  return filePath;
}
