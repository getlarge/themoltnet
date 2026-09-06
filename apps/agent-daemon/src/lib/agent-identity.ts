import type { AgentIdentity } from '@moltnet/crypto-service';
import { resolveAgentIdentity } from '@themoltnet/agent-runtime';
import { readConfig, type Whoami } from '@themoltnet/sdk';

import type { DaemonCredentialSource } from './agent-context.js';

/**
 * Build the non-secret identity projected into guests. Host git config is a
 * non-secret input and is consulted only on config-based hosts, which already
 * read that configuration for the signing seed; configless hosts never touch a
 * config directory.
 */
export async function resolveDaemonAgentIdentity(input: {
  agentName: string;
  whoami: Whoami;
  credentialSource: DaemonCredentialSource;
  agentDir: string;
  /** `Name <email>` from `--git-author` / `MOLTNET_GIT_AUTHOR`. */
  gitAuthor?: string;
}): Promise<AgentIdentity> {
  let hostGit: { name?: string; email?: string } | undefined;
  if (input.gitAuthor === undefined && input.credentialSource === 'config') {
    const config = await readConfig(input.agentDir);
    hostGit = config?.git
      ? { name: config.git.name, email: config.git.email }
      : undefined;
  }
  return resolveAgentIdentity({
    agentName: input.agentName,
    whoami: input.whoami,
    gitAuthor: input.gitAuthor,
    hostGit,
  });
}
