import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { AGENT_CREDENTIAL_SCOPES } from '@moltnet/models';
import {
  type Agent,
  assertIdentityAlias,
  assertTrustedConfigApiUrl,
  AuthenticationError,
  getIdentityDir,
  readConfig,
  requireSecureCredentialApiUrl,
  resolveAgentKey,
  type Whoami,
} from '@themoltnet/sdk';
import {
  connect,
  createNodeSecretProviderRegistry,
} from '@themoltnet/sdk/node';

import { assessIdentityPin, type IdentityPin } from './identity-pin.js';

/** Scopes a daemon key must carry; mirrors `DAEMON_REQUIRED_SCOPES`. */
const DAEMON_KEY_SCOPES = AGENT_CREDENTIAL_SCOPES;

/**
 * Where the daemon's credentials live.
 *
 * - `environment`: configless — `MOLTNET_AGENT_KEY` or `MOLTNET_AGENT_KEY_REF`
 *   holds the key; no agent files are read.
 * - `config`: `moltnet.json` supplies an `agent_key_ref`.
 *
 * This is deliberately *not* an authentication mode. The daemon authenticates
 * with a team-bound agent key either way: OAuth2 client_credentials was retired
 * (#2160) because it hands the daemon the full 17-scope agent grant against a
 * six-scope need, and because a Hydra token cannot be a Talos derivation parent.
 */
export type DaemonCredentialSource = 'environment' | 'config';

export interface DaemonAgentContext {
  agentDir: string;
  agentRootDir: string;
  agent: Agent;
  credentialSource: DaemonCredentialSource;
}

/**
 * Report where `connect()` will find the key, without ever reading the secret
 * value into anything logged. A non-blank `MOLTNET_AGENT_KEY` or
 * `MOLTNET_AGENT_KEY_REF` means configless; otherwise the key comes from
 * `moltnet.json`. This mirrors the SDK precedence, where an environment key
 * wins over the config file.
 *
 * Pure: `env` is passed in (the config module owns the `process.env` read).
 */
export function detectCredentialSource(
  env: NodeJS.ProcessEnv,
): DaemonCredentialSource {
  return env.MOLTNET_AGENT_KEY?.trim() || env.MOLTNET_AGENT_KEY_REF?.trim()
    ? 'environment'
    : 'config';
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
    /**
     * Explicit `--agent-root`. Honoured only when the operator actually passed
     * it: `<root>/.moltnet/<agent>/moltnet.json` is then used instead of the
     * central store. This is an explicit override, not the repository
     * auto-discovery the central-store cutover removed — nothing is searched
     * unless a path was named. Undefined means "central store only".
     */
    agentRootDir?: string;
    credentialSource?: DaemonCredentialSource;
    /**
     * `MOLTNET_API_URL` as the config module already read it. Supplied rather
     * than read here so this stays the daemon's single `process.env` owner.
     */
    envApiUrl?: string;
  } = {},
): Promise<DaemonAgentContext> {
  // One grammar, shared with the Go CLI and the daemon store. The previous
  // inline pattern rejected `.` and had no length bound, so it both refused
  // aliases the CLI creates and accepted names getIdentityDir then rejected
  // with a raw "invalid identity alias".
  assertIdentityAlias(agentName);
  // Configless runs take the key from the environment, so the directory is
  // only used for state and mounting and must NOT be gated on a moltnet.json
  // that will never exist there.
  const { agentDir, agentRootDir } = resolveIdentityLocation(
    agentName,
    options.agentRootDir,
    { requireConfig: options.credentialSource !== 'environment' },
  );
  if (options.credentialSource === 'environment') {
    // No config dir: the key (or its MOLTNET_AGENT_KEY_REF) comes from the
    // environment. The Node registry is still needed so a keyring or file
    // reference can be resolved.
    const agent = await connect({
      secretProviders: createNodeSecretProviderRegistry(),
    });
    return {
      agentDir,
      agentRootDir,
      agent,
      credentialSource: 'environment',
    };
  }

  // The host needs `moltnet.json` to build its own Agent. Reading it on the
  // host never implies projecting it into the guest — the guest receives no
  // MoltNet credential material.
  const config = await readConfig(agentDir);
  if (!config?.agent_key_ref) {
    throw new Error(agentKeyRequiredMessage(agentDir, agentName));
  }
  const secretProviders = createNodeSecretProviderRegistry();
  // Resolve the key here and hand it to connect() explicitly rather than
  // letting ambient resolution pick. Ambient order puts environment OAuth2
  // client credentials *ahead* of a configured agent_key_ref
  // (connect-ambient.ts step 4 vs step 5), and `moltnet start` injects
  // MOLTNET_CLIENT_ID / MOLTNET_CLIENT_SECRET into the daemon's environment
  // (start.go). Checking that agent_key_ref exists and then calling ambient
  // connect() would therefore still authenticate with the over-scoped OAuth2
  // token on the launcher path — the exact outcome #2160 exists to prevent.
  // An explicit agentKey is step 1 and beats every environment variable.
  const agentKey = await resolveAgentKey(config, secretProviders);
  if (!agentKey) {
    throw new Error(agentKeyRequiredMessage(agentDir, agentName));
  }
  const agent = await connect({
    configDir: agentDir,
    secretProviders,
    agentKey,
    apiUrl: resolveConfigApiUrl(config, options.envApiUrl),
  });
  return {
    agentDir,
    agentRootDir,
    agent,
    credentialSource: 'config',
  };
}

/**
 * The daemon runs on an agent key only. A `moltnet.json` carrying OAuth2
 * client credentials but no `agent_key_ref` is the pre-#2160 shape, and
 * `connect()` would happily authenticate it — so this has to be refused here
 * rather than left to surface as an over-scoped token later.
 */
function agentKeyRequiredMessage(agentDir: string, agentName: string): string {
  return (
    `${join(agentDir, 'moltnet.json')} has no "agent_key_ref". The daemon ` +
    `requires a team-bound agent key; OAuth2 client_credentials is no longer ` +
    `accepted. Mint one with:\n\n` +
    `  moltnet agents keys create --agent-id <agent-uuid> ` +
    `--team-id <team-uuid> --name ${agentName}-daemon --store\n\n` +
    `That writes "agent_key_ref" into moltnet.json and keeps the secret in a ` +
    `provider. The key needs these scopes: ` +
    `${DAEMON_KEY_SCOPES.join(' ')}.\n` +
    `Alternatively set MOLTNET_AGENT_KEY or MOLTNET_AGENT_KEY_REF to run ` +
    `configless.`
  );
}

/**
 * The central identity directory, unless an explicit `--agent-root` names a
 * legacy bundle that actually exists.
 *
 * The flag is documented as "Directory that owns .moltnet/<agent>" and is still
 * accepted by `once`, `poll` and `sync-sessions`. Ignoring it silently sent
 * every caller that passes one — sandboxed runs, the e2e harness — to a
 * central store they never populated, and failed with a bare "No credentials
 * found".
 */
/**
 * `agentDir` is where credentials live; `agentRootDir` is the directory that
 * OWNS it and is mounted into the sandbox. They differ for a legacy bundle
 * (`<root>/.moltnet/<agent>` inside `<root>`) and coincide for a central
 * identity, which owns nothing above itself. Collapsing them mounted the
 * credentials directory itself into the guest.
 */
function resolveIdentityLocation(
  agentName: string,
  explicitRootDir: string | undefined,
  { requireConfig }: { requireConfig: boolean },
): { agentDir: string; agentRootDir: string } {
  const root = explicitRootDir?.trim();
  if (root) {
    const bundle = join(root, '.moltnet', agentName);
    if (!requireConfig || existsSync(join(bundle, 'moltnet.json'))) {
      return { agentDir: bundle, agentRootDir: root };
    }
  }
  const central = getIdentityDir(agentName);
  return { agentDir: central, agentRootDir: central };
}

/**
 * Pick the API URL for an explicitly-keyed connect, preserving the checks
 * ambient config resolution would have applied. An explicit `apiUrl` skips
 * ambient's own normalisation, so a URL taken from `moltnet.json` still has to
 * clear the config-trust and transport checks before it is used.
 */
function resolveConfigApiUrl(
  config: { endpoints?: { api?: string } },
  envApiUrl?: string,
): string | undefined {
  if (envApiUrl?.trim()) return undefined; // connect() reads it from the env
  const fromConfig = config.endpoints?.api?.trim();
  if (!fromConfig) return undefined;
  assertTrustedConfigApiUrl(fromConfig);
  requireSecureCredentialApiUrl(fromConfig);
  return fromConfig;
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
