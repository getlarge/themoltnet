import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { OPERATOR_OAUTH } from '@moltnet/models';
import { isDefaultStore } from '@themoltnet/sdk/node';

import { writeJsonAtomic } from './store.js';

export function defaultAgentServerPort(root: string): number {
  return isDefaultStore({ root }) ? OPERATOR_OAUTH.serverPort : 0;
}

interface AgentServerEndpoint {
  version: 1;
  instanceId: string;
  pid?: number;
  url: string;
}

function endpointPath(root: string): string {
  return join(root, 'agent-server-endpoint.json');
}

function validateUrl(value: string): void {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== '127.0.0.1' ||
    url.port === '0' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^https:\/\/127\.0\.0\.1(?::[1-9]\d{0,4})?$/.test(value)
  ) {
    throw new Error('Agent Server discovery requires a loopback HTTPS origin');
  }
}

export function readAgentServerEndpoint(
  root: string,
): AgentServerEndpoint | null {
  let raw: string;
  try {
    raw = readFileSync(endpointPath(root), 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw cause;
  }
  try {
    const value = JSON.parse(raw) as Partial<AgentServerEndpoint>;
    if (
      value.version !== 1 ||
      typeof value.instanceId !== 'string' ||
      value.instanceId.length !== 36 ||
      !/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu.test(
        value.instanceId,
      ) ||
      typeof value.url !== 'string'
    ) {
      throw new Error('Invalid Agent Server discovery metadata');
    }
    validateUrl(value.url);
    if (value.pid !== undefined) {
      if (
        !Number.isSafeInteger(value.pid) ||
        value.pid <= 0 ||
        value.pid > 2147483647
      )
        throw new Error('Invalid process ID');
      try {
        process.kill(value.pid, 0);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ESRCH') return null;
      }
    }
    return value as AgentServerEndpoint;
  } catch (cause) {
    throw new Error(
      `Invalid Agent Server discovery at ${endpointPath(root)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/** Publish and release only while holding the selected store's singleton lock. */
export function publishAgentServerEndpoint(
  root: string,
  url: string,
): { record: AgentServerEndpoint; release(): void } {
  validateUrl(url);
  const endpoint: AgentServerEndpoint = {
    version: 1,
    instanceId: randomUUID(),
    pid: process.pid,
    url,
  };
  writeJsonAtomic(endpointPath(root), endpoint);
  return {
    record: endpoint,
    release() {
      try {
        if (readAgentServerEndpoint(root)?.instanceId === endpoint.instanceId) {
          rmSync(endpointPath(root), { force: true });
        }
      } catch {
        // Best-effort cleanup must preserve the server's original exit status.
        // Unreadable or replaced metadata is not ours to remove.
      }
    },
  };
}
