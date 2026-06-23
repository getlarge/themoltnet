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
 * Looks under an explicit agent root first, then falls back to the git root
 * when available. Fails fast if the dir is missing — credentials are required,
 * the daemon never falls back to unauthenticated calls.
 */
export async function resolveAgentContext(
  agentName: string,
  options: { agentRootDir?: string } = {},
): Promise<DaemonAgentContext> {
  if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
    throw new Error(
      `Invalid agent name "${agentName}": must match /^[a-zA-Z0-9_-]+$/`,
    );
  }
  const roots = resolveCredentialRoots(options.agentRootDir);
  for (const rootDir of roots) {
    const agentDir = join(rootDir, '.moltnet', agentName);
    if (existsSync(join(agentDir, 'moltnet.json'))) {
      const agent = await connect({ configDir: agentDir });
      return { agentDir, agent };
    }
  }

  const tried = roots.map((root) => join(root, '.moltnet', agentName));
  throw new Error(
    `Missing credentials for ${agentName}. ` +
      `Checked ${tried.join(', ')}. Run the agent onboarding flow first.`,
  );
}

function resolveCredentialRoots(agentRootDir?: string): string[] {
  const roots = agentRootDir ? [agentRootDir] : [];
  try {
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    if (!roots.includes(gitRoot)) roots.push(gitRoot);
  } catch {
    // Repo-free daemon runs are valid as long as the explicit root has creds.
  }
  return roots;
}
