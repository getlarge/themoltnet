import { basename, dirname } from 'node:path';

import { cryptoService } from '@moltnet/crypto-service';
import {
  resolveIdentitySeed,
  type SecretProviderRegistry,
} from '@themoltnet/sdk';
import {
  CredentialPersistenceError,
  EnrollmentRecoveryError,
  enrollTeam,
} from '@themoltnet/sdk/node';

import { loadAgentActivation } from './identity.js';
import type { AgentServerStore } from './store.js';

export type TeamEnrollmentInput = {
  code: string;
  idempotencyKey: string;
} & ({ mode: 'enroll' } | { mode: 'replace'; teamId: string });

/** Native/paired callers receive metadata only; signing and storage stay local. */
export async function enrollIdentityTeam(options: {
  store: AgentServerStore;
  alias: string;
  managed: SecretProviderRegistry;
  external: SecretProviderRegistry;
  input: TeamEnrollmentInput;
}) {
  const { activation, config } = await loadAgentActivation(
    options.store,
    options.alias,
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
  const seed = await resolveIdentitySeed(config, registry);
  const configPath =
    activation.source === 'managed'
      ? options.store.agentPath(options.alias)
      : activation.configPath;
  try {
    const result = await enrollTeam({
      code: options.input.code,
      idempotencyKey: options.input.idempotencyKey,
      replacement,
      signer: { sign: (message) => cryptoService.sign(message, seed) },
      configDir: dirname(configPath),
      secretProvider: provider,
      apiUrl: activation.apiUrl ?? config.endpoints?.api,
    });
    return {
      state: 'persisted' as const,
      teamId: result.teamId,
      keyId: result.key.id,
    };
  } catch (error) {
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
          : 'No credential secret was captured. Retained retry context can identify the issuance; a completed issuance requires a fresh invitation if its secret is lost.',
      };
    }
    throw new Error('Team enrollment could not be completed');
  }
}
