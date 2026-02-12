import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { McpConfig } from './register.js';

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
