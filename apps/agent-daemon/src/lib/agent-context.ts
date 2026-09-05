import {
  type Agent,
  assertIdentityAlias,
  AuthenticationError,
  getIdentityDir,
  readConfig,
  type Whoami,
} from '@themoltnet/sdk';
import {
  connect,
  createNodeSecretProviderRegistry,
} from '@themoltnet/sdk/node';

import { assessIdentityPin, type IdentityPin } from './identity-pin.js';

/** The mechanism `connect()` actually authenticated with. */
export type DaemonAuthMechanism = 'agent-key' | 'oauth2';

export interface DaemonAgentContext {
  agentDir: string;
  agentRootDir: string;
  agent: Agent;
  /**
   * Where credentials came from: the configless environment
   * (`MOLTNET_AGENT_KEY` / `MOLTNET_AGENT_KEY_REF`) or `moltnet.json`.
   */
  credentialSource: 'environment' | 'config';
  /**
   * The authentication mechanism in use. Differs from `credentialSource`
   * when `moltnet.json` carries an `agent_key_ref`: the source is `config`
   * but the mechanism is `agent-key`.
   */
  authMechanism: DaemonAuthMechanism;
}

/**
 * Where the daemon's credentials come from — this is the *credential source*,
 * not necessarily the authentication mechanism (see `DaemonAgentContext`).
 *
 * - `agent-key`: configless — a static, team-bound bearer secret from
 *   `MOLTNET_AGENT_KEY` (or `MOLTNET_AGENT_KEY_REF`); no agent files are read.
 * - `oauth2`: `moltnet.json` supplies the credentials; the mechanism is the
 *   OAuth2 client-credentials flow unless the file carries `agent_key_ref`.
 */
export type DaemonAuthMode = 'agent-key' | 'oauth2';

/**
 * Report which auth mode `connect()` will use, without ever reading the secret
 * value into anything logged. Agent-key mode is selected when
 * `MOLTNET_AGENT_KEY` or `MOLTNET_AGENT_KEY_REF` holds a non-blank value —
 * mirroring the SDK precedence
 * where an environment key opts into key mode ahead of the config-file OAuth2
 * credentials. The daemon never passes explicit in-code credentials to
 * `connect()`, so this env-only check matches what `connect()` actually does.
 *
 * Pure: `env` is passed in (the config module owns the `process.env` read).
 */
export function detectAuthMode(env: NodeJS.ProcessEnv): DaemonAuthMode {
  return env.MOLTNET_AGENT_KEY?.trim() || env.MOLTNET_AGENT_KEY_REF?.trim()
    ? 'agent-key'
    : 'oauth2';
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
  expectedIdentity?: IdentityPin;
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
  const expected = options.expectedIdentity;
  if (expected && !assessIdentityPin(whoami, expected).ok) {
    throw new Error(
      'Daemon startup validation failed: authenticated identity does not match the Agent Server activation.',
    );
  }
  return whoami;
}

/**
 * Resolve the agent's MoltNet credentials directory and connect via SDK.
 *
 * The daemon selects the same central identity directory as the CLI. It never
 * inspects a repository, Git state, or legacy agent bundle for credentials.
 */
export async function resolveAgentContext(
  agentName: string,
  options: {
    agentRootDir?: string;
    authMode?: DaemonAuthMode;
  } = {},
): Promise<DaemonAgentContext> {
  // One grammar, shared with the Go CLI and the daemon store. The previous
  // inline pattern rejected `.` and had no length bound, so it both refused
  // aliases the CLI creates and accepted names getIdentityDir then rejected
  // with a raw "invalid identity alias".
  assertIdentityAlias(agentName);
  void options.agentRootDir; // retained for source compatibility; no discovery.
  const agentDir = getIdentityDir(agentName);
  if (options.authMode === 'agent-key') {
    // No config dir: the key (or its MOLTNET_AGENT_KEY_REF) comes from the
    // environment. The Node registry is still needed so a keyring or file
    // reference can be resolved.
    const agent = await connect({
      secretProviders: createNodeSecretProviderRegistry(),
    });
    return {
      agentDir,
      agentRootDir: agentDir,
      agent,
      credentialSource: 'environment',
      authMechanism: 'agent-key',
    };
  }

  // OAuth2: the host needs `moltnet.json` to build its own Agent. Reading it on
  // the host never implies projecting it into the guest — the guest receives no
  // MoltNet credential material.
  const agent = await connect({
    configDir: agentDir,
    secretProviders: createNodeSecretProviderRegistry(),
  });
  // connect() prefers a configured agent_key_ref over OAuth2; report the
  // mechanism it actually used so diagnostics and telemetry agree.
  const config = await readConfig(agentDir);
  return {
    agentDir,
    agentRootDir: agentDir,
    agent,
    credentialSource: 'config',
    authMechanism: config?.agent_key_ref ? 'agent-key' : 'oauth2',
  };
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
