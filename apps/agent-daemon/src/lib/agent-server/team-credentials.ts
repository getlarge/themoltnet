import { DAEMON_MINIMUM_SCOPES } from '@moltnet/models';
import { resolveAgentKey, type SecretProviderRegistry } from '@themoltnet/sdk';
import { connect } from '@themoltnet/sdk/node';

import {
  type ActivatedAgent,
  loadAgentActivation,
  loadEnrollmentIdentity,
} from './identity.js';
import type { AgentServerStore } from './store.js';

export const AGENT_SERVER_REQUIRED_SCOPES = [...DAEMON_MINIMUM_SCOPES];

export interface CredentialMetadata {
  keyId: string;
  /** Missing means the API predates expiry metadata; null explicitly means no expiry. */
  expiresAt?: string | null;
  verifiedAt: string;
  scopes: string[];
}
export interface CredentialBlocker {
  code:
    | 'agent_key_missing'
    | 'agent_key_binding_invalid'
    | 'agent_key_scopes_insufficient'
    | 'agent_key_unavailable';
  message: string;
  remedy: string;
}
export class TeamCredentialError extends Error {
  constructor(readonly blocker: CredentialBlocker) {
    super(blocker.message);
  }
}
export function credentialBlocker(error: unknown): CredentialBlocker {
  return error instanceof TeamCredentialError
    ? error.blocker
    : {
        code: 'agent_key_unavailable',
        message:
          'This team credential could not be verified or read its team resources.',
        remedy:
          'Check connectivity and team access, or renew this team credential.',
      };
}
const snapshots = new WeakMap<
  ActivatedAgent,
  {
    agentKey: string;
    client: Awaited<ReturnType<typeof connect>>;
    metadata: CredentialMetadata;
  }
>();
/** Capture is internal to the verifier; exported for injected verifier test doubles. */
export function captureTeamCredential(
  agent: ActivatedAgent,
  snapshot: NonNullable<ReturnType<typeof snapshots.get>>,
) {
  snapshots.set(agent, snapshot);
  return agent;
}
export function requireCredentialSnapshot(agent: ActivatedAgent) {
  const snapshot = snapshots.get(agent);
  if (!snapshot)
    throw new Error('A verified team credential snapshot is required');
  return snapshot;
}

async function verifyTeamCredential(
  activated: ActivatedAgent,
  agentKey: string,
  teamId: string,
  connectImpl: typeof connect,
  signal?: AbortSignal,
) {
  const { config, activation } = activated;
  const client = await connectImpl({
    agentKey,
    apiUrl:
      activation.apiUrl ??
      (activation.source === 'external' ? activation.configApiUrl : undefined),
    signal,
  });
  const whoami = await client.agents.whoami({ signal });
  if (
    whoami.subjectType !== 'agent' ||
    whoami.subjectId !== activation.subjectId ||
    whoami.publicKey !== config.keys.public_key ||
    whoami.fingerprint !== config.keys.fingerprint ||
    whoami.publicKey !== activation.publicKey ||
    whoami.fingerprint !== activation.fingerprint ||
    whoami.credentialBinding?.bindingScope !== 'team' ||
    whoami.credentialBinding.boundTeamId !== teamId
  )
    throw new TeamCredentialError({
      code: 'agent_key_binding_invalid',
      message: 'The selected credential does not match this identity and team.',
      remedy: 'Renew the selected team credential.',
    });
  const metadata: CredentialMetadata = {
    keyId: whoami.credentialBinding.keyId,
    ...(Object.hasOwn(whoami.credentialBinding, 'expiresAt')
      ? { expiresAt: whoami.credentialBinding.expiresAt }
      : {}),
    scopes: [...(whoami.scopes ?? [])],
    verifiedAt: new Date().toISOString(),
  };
  const missing = AGENT_SERVER_REQUIRED_SCOPES.filter(
    (scope) => !metadata.scopes.includes(scope),
  );
  if (missing.length)
    throw new TeamCredentialError({
      code: 'agent_key_scopes_insufficient',
      message: `This credential lacks ${missing.join(', ')}.`,
      remedy:
        'Renew through browser approval with the required desktop scopes.',
    });
  return { client, metadata };
}

/** Verify a captured credential without changing the live team slot. */
export async function verifyCandidateTeamCredential(
  store: AgentServerStore,
  alias: string,
  agentKey: string,
  teamId: string,
  connectImpl: typeof connect = connect,
): Promise<CredentialMetadata> {
  const activated = await loadEnrollmentIdentity(store, alias);
  return (await verifyTeamCredential(activated, agentKey, teamId, connectImpl))
    .metadata;
}

/** The only supervised credential path. No fallback reference or OAuth resolution. */
export async function verifyTeamActivation(
  store: AgentServerStore,
  alias: string,
  managed: SecretProviderRegistry,
  external: SecretProviderRegistry,
  connectImpl: typeof connect = connect,
  signal?: AbortSignal,
  teamId?: string,
): Promise<ActivatedAgent> {
  const activated = await loadAgentActivation(store, alias);
  const { config, activation } = activated;
  const reference = teamId ? config.agent_key_refs?.[teamId] : undefined;
  if (!teamId || !reference)
    throw new TeamCredentialError({
      code: 'agent_key_missing',
      message: 'No credential is indexed for this team.',
      remedy:
        'Enroll into this team or explicitly index its existing team-bound credential.',
    });
  let agentKey: string;
  try {
    const resolved = await resolveAgentKey(
      {
        ...config,
        agent_key_ref: undefined,
        agent_key_refs: { [teamId]: reference },
      },
      activation.source === 'managed' ? managed : external,
      teamId,
    );
    if (!resolved) throw new Error('Missing selected key');
    agentKey = resolved;
  } catch {
    throw new TeamCredentialError({
      code: 'agent_key_unavailable',
      message: 'The selected team credential is unavailable.',
      remedy: 'Repair its secret provider or renew this team credential.',
    });
  }
  const { client, metadata } = await verifyTeamCredential(
    activated,
    agentKey,
    teamId,
    connectImpl,
    signal,
  );
  // Last verification is display information, never an authorization cache.
  store.writeCredentialMetadata(alias, teamId, metadata);
  activated.boundTeamId = teamId;
  return captureTeamCredential(activated, { agentKey, client, metadata });
}
