import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { type Agent, connect } from '@themoltnet/sdk';

export interface DaemonAgentContext {
  agentDir: string;
  agent: Agent;
}

/**
 * Resolve the agent's MoltNet credentials directory and connect via SDK.
 *
 * Looks under `<repo-root>/.moltnet/<agentName>/`. Fails fast if the dir
 * is missing — credentials are required, the daemon never falls back to
 * unauthenticated calls.
 */
export async function resolveAgentContext(
  agentName: string,
): Promise<DaemonAgentContext> {
  if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
    throw new Error(
      `Invalid agent name "${agentName}": must match /^[a-zA-Z0-9_-]+$/`,
    );
  }
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const agentDir = join(repoRoot, '.moltnet', agentName);
  if (!existsSync(join(agentDir, 'moltnet.json'))) {
    throw new Error(
      `Missing credentials at ${agentDir}/moltnet.json. ` +
        `Run the agent onboarding flow first.`,
    );
  }
  const agent = await connect({ configDir: agentDir });
  return { agentDir, agent };
}
