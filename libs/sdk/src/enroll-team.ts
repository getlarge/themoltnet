import { createHash } from 'node:crypto';

import {
  agentKeyKey,
  assertAgentKeyReferenceBinding,
  assertCanonicalConfig,
  readConfig,
  resolveConfigDir,
  updateTeamAgentKeyReference,
} from '@moltnet/agent-config';
import type { TeamAgentKey } from '@moltnet/api-client';

import type { Agent } from './agent.js';
import { prepareCredentialPersistence } from './credential-persistence.js';
import type { SecretReference } from './credentials.js';
import { MoltNetError } from './errors.js';
import type { SecretProvider } from './secrets.js';

export interface EnrollTeamOptions {
  /** Native human-authorized issuance. The callback and its bearer stay in the controller. */
  provision?: () => Promise<{
    teamId: string;
    role: 'member';
    agentKey: { key: TeamAgentKey; secret: string };
  }>;
  /** Non-secret target retained before a native one-time exchange. */
  provisioningContext?: {
    teamId: string;
    operation: 'enroll' | 'renew';
    scopes: string[];
  };
  /** Existing authenticated agent; no destination-team context is required. */
  agent?: Pick<Agent, 'teams'>;
  apiUrl?: string;
  /** Explicitly replace exactly this team slot, with a writer-lock comparison. */
  replacement?: { teamId: string };
  code?: string;
  idempotencyKey: string;
  configDir?: string;
  secretProvider: SecretProvider;
}

export interface EnrollTeamResult {
  teamId: string;
  role: 'owner' | 'manager' | 'executor' | 'member';
  key: TeamAgentKey;
  reference: SecretReference;
}

/** The native controller guarantees that credential issuance was never attempted. */
export class ProvisioningNotStartedError extends Error {
  constructor(cause: unknown) {
    super('Approval did not reach credential issuance; retry approval', {
      cause,
    });
    this.name = 'ProvisioningNotStartedError';
  }
}

export class EnrollmentRecoveryError extends Error {
  readonly code = 'ENROLLMENT_RESPONSE_UNAVAILABLE';
  readonly secretCaptured = false;
  constructor(
    readonly recoveryPath: string,
    readonly issuedKeyId?: string,
    readonly statusCode?: number,
  ) {
    super(
      'Enrollment response unavailable; protected retry context was retained. No credential secret was captured.',
    );
  }
}

/** Enroll an existing identity and persist its grant without returning a secret. */
export async function enrollTeam(
  options: EnrollTeamOptions,
): Promise<EnrollTeamResult> {
  if (!options.idempotencyKey.trim())
    throw new Error('Enrollment requires an idempotency key');
  if (
    !options.secretProvider.capabilities.write ||
    !options.secretProvider.write
  ) {
    throw new Error('Enrollment requires a writable secret provider');
  }
  if (!options.provision && !options.agent)
    throw new Error(
      'Enrollment requires human provisioning or an authenticated agent',
    );
  if (options.replacement && !options.provision)
    throw new Error('Replacement requires human approval');
  const dir = await resolveConfigDir(options.configDir);
  if (!dir) throw new Error('Select an existing identity before enrollment');
  const config = await readConfig(dir);
  if (!config) throw new Error('Select an existing identity before enrollment');
  assertCanonicalConfig(config);
  assertAgentKeyReferenceBinding(
    {
      reference: {
        provider: options.secretProvider.name,
        key: agentKeyKey(config.subject_id, 'pending'),
      },
      teamId: 'pending',
    },
    config.subject_id,
  );
  const replacementTeam = options.replacement?.teamId;
  const observedReference = replacementTeam
    ? config.agent_key_refs?.[replacementTeam]
    : undefined;
  if (replacementTeam && !observedReference)
    throw new Error('Replacement requires an existing team slot');
  if (
    observedReference &&
    observedReference.provider !== options.secretProvider.name
  ) {
    throw new Error('Replacement must use the existing slot provider');
  }
  if (observedReference)
    assertAgentKeyReferenceBinding(
      { reference: observedReference, teamId: replacementTeam },
      config.subject_id,
    );
  const observedSecret = observedReference
    ? await options.secretProvider.read(observedReference.key)
    : null;
  const recovery = await prepareCredentialPersistence(dir, {
    subjectId: config.subject_id,
    code: options.code,
    idempotencyKey: options.idempotencyKey,
    expectedTeamId: replacementTeam ?? options.provisioningContext?.teamId,
    provisioning: options.provisioningContext,
    mode: options.provision ? 'human-pkce' : 'authenticated',
    observedReference,
    observedCredentialHash:
      observedSecret === null
        ? null
        : createHash('sha256').update(observedSecret).digest('hex'),
    apiUrl: options.apiUrl ?? config.endpoints?.api,
  });
  let result;
  try {
    result = options.provision
      ? await options.provision()
      : await options.agent!.teams.join(options.code ?? '', {
          issueAgentKey: true,
          idempotencyKey: options.idempotencyKey,
        });
  } catch (error) {
    if (error instanceof ProvisioningNotStartedError) {
      await recovery.cancel();
      throw error;
    }
    throw new EnrollmentRecoveryError(
      await recovery.retain(),
      error instanceof MoltNetError ? error.issuedKeyId : undefined,
      error instanceof MoltNetError ? error.statusCode : undefined,
    );
  }
  const issued = result.agentKey;
  if (!issued) {
    throw new EnrollmentRecoveryError(await recovery.retain());
  }
  const reference = {
    provider: options.secretProvider.name,
    key: agentKeyKey(config.subject_id, result.teamId),
  };
  await recovery.persist(
    options.secretProvider,
    reference,
    issued.secret,
    {
      subjectId: config.subject_id,
      teamId: result.teamId,
      keyId: issued.key?.id,
    },
    (store) =>
      updateTeamAgentKeyReference(
        config.subject_id,
        result.teamId,
        reference,
        dir,
        async (current) => {
          if (
            !issued.key ||
            !issued.key.id ||
            typeof issued.secret !== 'string' ||
            !issued.secret.trim() ||
            current.subject_id !== config.subject_id ||
            issued.key.agentId !== config.subject_id ||
            issued.key.bindingScope !== 'team' ||
            issued.key.teamId !== result.teamId ||
            (options.provisioningContext &&
              result.teamId !== options.provisioningContext.teamId)
          ) {
            throw new Error(
              'Enrollment credential is not bound to the selected identity and team',
            );
          }
          const currentReference = current.agent_key_refs?.[result.teamId];
          if (replacementTeam) {
            if (
              result.teamId !== replacementTeam ||
              currentReference?.provider !== observedReference?.provider ||
              currentReference?.key !== observedReference?.key ||
              (await options.secretProvider.read(observedReference!.key)) !==
                observedSecret
            ) {
              throw new Error('Team credential changed during replacement');
            }
            await options.secretProvider.write!(reference.key, issued.secret);
            if (
              (await options.secretProvider.read(reference.key)) !==
              issued.secret
            ) {
              throw new Error('Replacement read-back failed');
            }
          } else {
            if (currentReference)
              throw new Error(
                'Team already enrolled; confirm replacement explicitly',
              );
            await store();
          }
        },
      ),
  );
  return {
    teamId: result.teamId,
    role: result.role,
    key: issued.key as TeamAgentKey,
    reference,
  };
}
