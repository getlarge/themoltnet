import { basename, dirname } from 'node:path';

import { enrollmentProofMessage } from '@moltnet/crypto-service';
import { isLoopbackHostname } from '@moltnet/loopback-companion';
import { type SecretProviderRegistry, signBytes } from '@themoltnet/sdk';
import {
  CredentialPersistenceError,
  EnrollmentRecoveryError,
  ProvisioningNotStartedError,
  enrollTeam,
  type EnrollTeamResult,
} from '@themoltnet/sdk/node';

import { loadEnrollmentIdentity } from './identity.js';
import type { OperatorOAuth } from './operator-oauth.js';
import type { AgentServerStore } from './store.js';
import { AGENT_SERVER_REQUIRED_SCOPES } from './team-credentials.js';

export type TeamEnrollmentInput = {
  teamId: string;
  idempotencyKey: string;
} & ({ mode: 'enroll' } | { mode: 'replace' });

/** Native callers receive metadata only; approval and storage stay local. */
export async function enrollIdentityTeam(options: {
  store: AgentServerStore;
  alias: string;
  managed: SecretProviderRegistry;
  external: SecretProviderRegistry;
  input: TeamEnrollmentInput;
  oauth: OperatorOAuth;
  apiUrl: string;
  signal?: AbortSignal;
}) {
  const apiUrl = new URL(options.apiUrl);
  if (
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.hash ||
    (apiUrl.protocol !== 'https:' &&
      !(apiUrl.protocol === 'http:' && isLoopbackHostname(apiUrl.hostname)))
  )
    throw new Error('Provisioning requires a configured secure API endpoint');
  const { activation, config } = await loadEnrollmentIdentity(
    options.store,
    options.alias,
  );
  const identityApiUrl = activation.apiUrl ?? config.endpoints?.api;
  if (!identityApiUrl)
    throw new Error('The identity has no API environment configured');
  if (
    new URL(identityApiUrl).href.replace(/\/$/u, '') !==
    apiUrl.href.replace(/\/$/u, '')
  )
    throw new Error(
      'The identity belongs to another API environment. Select that environment in Server settings before enrollment.',
    );
  const registry =
    activation.source === 'managed' ? options.managed : options.external;
  const replacement =
    options.input.mode === 'replace'
      ? { teamId: options.input.teamId }
      : undefined;
  const providerName = replacement
    ? config.agent_key_refs?.[replacement.teamId]?.provider
    : activation.source === 'managed'
      ? 'file'
      : config.keys.private_key_ref?.provider;
  const provider = providerName ? registry.get(providerName) : undefined;
  if (!provider?.capabilities.write)
    throw new Error('Enrollment requires a writable identity secret provider');
  const configPath =
    activation.source === 'managed'
      ? options.store.agentPath(options.alias)
      : activation.configPath;
  try {
    const result = await enrollTeam({
      idempotencyKey: options.input.idempotencyKey,
      provisioningContext: {
        teamId: options.input.teamId,
        operation: replacement ? 'renew' : 'enroll',
        scopes: [...AGENT_SERVER_REQUIRED_SCOPES],
      },
      replacement,
      provision: async () => {
        const grant = {
          agentId: config.subject_id,
          teamId: options.input.teamId,
          operation: replacement ? ('renew' as const) : ('enroll' as const),
          scopes: [...AGENT_SERVER_REQUIRED_SCOPES],
          idempotencyKey: options.input.idempotencyKey,
        };
        let token: string;
        let agentProof: string | undefined;
        try {
          token = await options.oauth.authorize(grant, options.signal);
          agentProof = replacement
            ? undefined
            : await signBytes(
                Buffer.from(
                  enrollmentProofMessage({ accessToken: token, grant }),
                ).toString('base64'),
                dirname(configPath),
                registry,
              );
        } catch (error) {
          throw new ProvisioningNotStartedError(error);
        }
        const response = await fetch(
          new URL('/oauth2/provision', options.apiUrl),
          {
            method: 'POST',
            redirect: 'error',
            signal: options.signal
              ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
              : AbortSignal.timeout(30_000),
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(agentProof ? { agentProof } : {}),
          },
        );
        if (!response.ok)
          throw new Error(
            'Provisioning unavailable; inspect recovery before fresh approval',
          );
        const agentKey = (await response.json()) as {
          key: EnrollTeamResult['key'];
          secret: string;
        };
        return { teamId: options.input.teamId, role: 'member', agentKey };
      },
      configDir: dirname(configPath),
      secretProvider: provider,
      apiUrl: options.apiUrl,
    });
    // Human approval authorizes issuance for the selected identity and team.
    // Future catalogue/run access still performs live, exact-slot verification.
    if (!options.store.readActivation(options.alias))
      options.store.writeActivation(activation);
    return {
      state: 'persisted' as const,
      teamId: result.teamId,
      keyId: result.key.id,
    };
  } catch (error) {
    if (error instanceof ProvisioningNotStartedError) throw error;
    if (
      error instanceof CredentialPersistenceError ||
      error instanceof EnrollmentRecoveryError
    ) {
      return {
        state: 'recovery_required' as const,
        secretCaptured: error.secretCaptured,
        ...(error.issuedKeyId ? { issuedKeyId: error.issuedKeyId } : {}),
        ...(error.recoveryPath
          ? { recoveryId: basename(error.recoveryPath) }
          : {}),
        message: error.secretCaptured
          ? 'The credential was captured locally but persistence is incomplete. Recover the captured credential before retrying enrollment.'
          : 'No credential secret was captured. Retained retry context can identify the issuance; a completed issuance requires a fresh approval if its secret is lost.',
      };
    }
    throw new Error('Team enrollment could not be completed', { cause: error });
  }
}
