import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Agent,connect } from '@themoltnet/sdk';

interface MoltNetConfig {
  endpoints?: { api?: string };
}

export interface TasksApiContext {
  agentDir: string;
  apiUrl: string;
  agent: Agent;
  auth: () => Promise<string>;
}

export async function resolveTasksApiContext(
  repoRoot: string,
  agentName: string,
): Promise<TasksApiContext> {
  const agentDir = join(repoRoot, '.moltnet', agentName);
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

export function parseSetArgs(pairs: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      throw new Error(
        `Invalid --set "${pair}": expected key=value with a non-empty key`,
      );
    }
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error(
        `Invalid --set key "${key}": must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`,
      );
    }
    map.set(key, value);
  }
  return map;
}

export function substituteTemplate(
  raw: string,
  values: Map<string, string>,
): string {
  const applied = raw.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (_, k) => (values.has(k) ? (values.get(k) as string) : `{{${k}}}`),
  );
  const leftover = [
    ...applied.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g),
  ];
  if (leftover.length > 0) {
    const missing = [...new Set(leftover.map((m) => m[1]))].sort();
    throw new Error(
      `Template has unsubstituted placeholders: ${missing
        .map((k) => `{{${k}}}`)
        .join(', ')}. Pass them via --set key=value.`,
    );
  }
  return applied;
}
