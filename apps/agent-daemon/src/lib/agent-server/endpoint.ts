import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { OPERATOR_OAUTH } from '@moltnet/models';
import { canonicalStoreRoot, resolveStoreRoot } from '@themoltnet/sdk/node';

import { writeJsonAtomic } from './store.js';

export function defaultAgentServerPort(root: string): number {
  return canonicalStoreRoot(root) ===
    canonicalStoreRoot(resolveStoreRoot({ env: {} }))
    ? OPERATOR_OAUTH.serverPort
    : 0;
}

interface AgentServerEndpoint {
  version: 1;
  instanceId: string;
  url: string;
}

function endpointPath(root: string): string {
  return join(root, 'agent-server-endpoint.json');
}

function validateUrl(value: string): void {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port === '0' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^https?:\/\/127\.0\.0\.1(?::[1-9]\d{0,4})?$/.test(value)
  ) {
    throw new Error(
      'Agent Server discovery requires a loopback HTTP(S) origin',
    );
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
  const value = JSON.parse(raw) as Partial<AgentServerEndpoint>;
  if (
    value.version !== 1 ||
    typeof value.instanceId !== 'string' ||
    typeof value.url !== 'string'
  ) {
    throw new Error('Invalid Agent Server discovery metadata');
  }
  validateUrl(value.url);
  return value as AgentServerEndpoint;
}

/** Publish and release only while holding the selected store's singleton lock. */
export function publishAgentServerEndpoint(
  root: string,
  url: string,
): { release(): void } {
  validateUrl(url);
  const endpoint: AgentServerEndpoint = {
    version: 1,
    instanceId: randomUUID(),
    url,
  };
  writeJsonAtomic(endpointPath(root), endpoint);
  return {
    release() {
      if (readAgentServerEndpoint(root)?.instanceId === endpoint.instanceId) {
        rmSync(endpointPath(root), { force: true });
      }
    },
  };
}
