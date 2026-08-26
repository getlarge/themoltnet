import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  type Agent,
  AuthenticationError,
  connect,
  type Whoami,
} from '@themoltnet/sdk';
import { createNodeSecretProviderRegistry } from '@themoltnet/sdk/node';

export interface DaemonAgentContext {
  agentDir: string;
  agentRootDir: string;
  agent: Agent;
}

/**
 * How the daemon authenticates to MoltNet.
 *
 * - `agent-key`: a static, team-bound bearer secret from `MOLTNET_AGENT_KEY`.
 * - `oauth2`: the default client-credentials flow using the agent's
 *   `moltnet.json` client id/secret.
 */
export type DaemonAuthMode = 'agent-key' | 'oauth2';

/**
 * Report which auth mode `connect()` will use, without ever reading the secret
 * value into anything logged. Agent-key mode is selected when
 * `MOLTNET_AGENT_KEY` holds a non-blank value — mirroring the SDK precedence
 * where an environment key opts into key mode ahead of the config-file OAuth2
 * credentials. The daemon never passes explicit in-code credentials to
 * `connect()`, so this env-only check matches what `connect()` actually does.
 *
 * Pure: `env` is passed in (the config module owns the `process.env` read).
 */
export function detectAuthMode(env: NodeJS.ProcessEnv): DaemonAuthMode {
  return env.MOLTNET_AGENT_KEY?.trim() ? 'agent-key' : 'oauth2';
}

/** Result of the pure startup-binding assessment. */
export type StartupBindingAssessment =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Pure check: may the identity described by `whoami` operate the daemon as
 * `teamId`? Kept side-effect free so it can be unit-tested in isolation.
 *
 * Rules (see design entry edb848a1):
 * - The subject must be an `agent`; a human credential can never run the daemon.
 * - A team-bound agent key (`credentialBinding.bindingScope === 'team'`) must match the
 *   `--team` the daemon was started with. A key is an immutable team ceiling, so
 *   a mismatch would only surface as an obscure mid-poll 403 otherwise.
 * - An identity-scoped key or an OAuth2 identity is accepted; normal team-scoped
 *   authorization governs those requests.
 */
export function assessStartupBinding(
  whoami: Whoami,
  teamId?: string,
): StartupBindingAssessment {
  if (whoami.subjectType !== 'agent') {
    return {
      ok: false,
      reason:
        `the daemon must authenticate as an agent, but whoami reported ` +
        `subjectType "${whoami.subjectType}". Provide agent credentials ` +
        `(an agent key or the agent's client id/secret).`,
    };
  }
  const boundTeamId =
    whoami.credentialBinding?.bindingScope === 'team'
      ? whoami.credentialBinding.boundTeamId
      : undefined;
  if (teamId && boundTeamId && boundTeamId !== teamId) {
    return {
      ok: false,
      reason:
        `the agent key is bound to team ${boundTeamId}, but the daemon was ` +
        `started with --team ${teamId}. Restart with --team ${boundTeamId}, ` +
        `or issue a key for team ${teamId}.`,
    };
  }
  return { ok: true };
}

/** Minimal shape needed to run the startup binding check — the SDK `Agent`
 *  satisfies it structurally, and unit tests can pass a light stub. */
export interface StartupWhoamiSource {
  agents: { whoami(): Promise<Whoami> };
}

/**
 * Validate at startup — after `connect()`, before polling — that the connected
 * credential can operate as `teamId`, failing fast with an actionable message
 * instead of letting an obscure 401/403 surface mid-poll. Runs in both auth
 * modes; in OAuth2 mode it also doubles as an API-reachability and
 * subject-type check. Returns the `whoami` so the caller can log the resolved
 * identity (never the secret).
 */
export async function validateStartupBinding(options: {
  agent: StartupWhoamiSource;
  teamId?: string;
}): Promise<Whoami> {
  let whoami: Whoami;
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt += 1) {
    try {
      whoami = await options.agent.agents.whoami();
      break;
    } catch (err) {
      if (err instanceof AuthenticationError) {
        throw new Error(`Daemon startup authentication failed: ${err.message}`);
      }
      if (attempt >= maxAttempts || !isTransientWhoamiError(err)) throw err;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100 * attempt);
      });
    }
  }
  const assessment = assessStartupBinding(whoami, options.teamId);
  if (!assessment.ok) {
    throw new Error(`Daemon startup validation failed: ${assessment.reason}`);
  }
  return whoami;
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
  options: {
    agentRootDir?: string;
    authMode?: DaemonAuthMode;
  } = {},
): Promise<DaemonAgentContext> {
  if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
    throw new Error(
      `Invalid agent name "${agentName}": must match /^[a-zA-Z0-9_-]+$/`,
    );
  }
  const roots = resolveCredentialRoots(options.agentRootDir);
  if (options.authMode === 'agent-key') {
    const rootDir = roots[0] ?? process.cwd();
    const agentDir = join(rootDir, '.moltnet', agentName);
    const agent = await connect();
    return { agentDir, agentRootDir: rootDir, agent };
  }

  // OAuth2: the host needs `moltnet.json` to build its own Agent. Reading it on
  // the host never implies projecting it into the guest — the guest receives no
  // MoltNet credential material.
  const located = locateAgentConfig(roots, agentName);
  if (located) {
    const agent = await connect({
      configDir: located.agentDir,
      secretProviders: createNodeSecretProviderRegistry(),
    });
    return {
      agentDir: located.agentDir,
      agentRootDir: located.rootDir,
      agent,
    };
  }

  const tried = roots.map((root) => join(root, '.moltnet', agentName));
  throw new Error(
    `Missing credentials for ${agentName}. ` +
      `Checked ${tried.join(', ')}. Run the agent onboarding flow first.`,
  );
}

function isTransientWhoamiError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!error || typeof error !== 'object') return false;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return (
    typeof statusCode === 'number' &&
    (statusCode === 408 || statusCode === 429 || statusCode >= 500)
  );
}

function locateAgentConfig(
  roots: readonly string[],
  agentName: string,
): { rootDir: string; agentDir: string } | undefined {
  for (const rootDir of roots) {
    const agentDir = join(rootDir, '.moltnet', agentName);
    if (existsSync(join(agentDir, 'moltnet.json')))
      return { rootDir, agentDir };
  }
  return undefined;
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
