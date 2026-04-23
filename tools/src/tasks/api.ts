import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { connect } from '@themoltnet/sdk';

interface MoltNetConfig {
  endpoints?: { api?: string };
}

export interface TasksApiContext {
  agentDir: string;
  apiUrl: string;
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
    auth: () => agent.getToken(),
  };
}

export async function taskApiFetch<T>(
  ctx: TasksApiContext,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await ctx.auth();
  const response = await fetch(`${ctx.apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Tasks API ${init.method ?? 'GET'} ${path} failed: ` +
        `${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
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
