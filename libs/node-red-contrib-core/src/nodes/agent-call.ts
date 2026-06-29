import type { Agent } from '@themoltnet/sdk';

import type { MoltnetAgentNode } from './agent.js';

export async function withAgent<T>(
  agentNode: MoltnetAgentNode,
  operation: (agent: Agent) => Promise<T>,
): Promise<T> {
  try {
    return await operation(await agentNode.getAgent());
  } catch (err) {
    if (!isUnauthorizedError(err)) throw err;
    agentNode.resetAgent();
    return operation(await agentNode.getAgent());
  }
}

function isUnauthorizedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as Record<string, unknown>;
  if (record.statusCode === 401 || record.status === 401) return true;
  if (record.code === 'https://themolt.net/problems/unauthorized') return true;
  return (
    typeof record.message === 'string' &&
    /\bunauthorized\b/i.test(record.message) &&
    /\btoken\b/i.test(record.message)
  );
}
