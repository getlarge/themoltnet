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
import {
  EnrollmentRequestError,
  type EnrollmentSigner,
  requestProofEnrollment,
} from './enrollment-proof.js';
import type { SecretProvider } from './secrets.js';
import { MoltNetError } from './errors.js';

export interface EnrollTeamOptions {
  /** Existing authenticated agent; no destination-team context is required. */
  agent?: Pick<Agent, 'teams'>;
  /** Local signing works without a valid API credential. Takes precedence over agent. */
  signer?: EnrollmentSigner;
  apiUrl?: string;
  /** Explicitly replace exactly this team slot, with a writer-lock comparison. */
  replacement?: { teamId: string };
  code: string;
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
  if (!options.signer && !options.agent)
    throw new Error('Enrollment requires a signer or authenticated agent');
  if (options.replacement && !options.signer)
    throw new Error('Replacement requires proof enrollment');
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
    expectedTeamId: replacementTeam,
    mode: options.signer ? 'proof' : 'authenticated',
    observedReference,
    observedCredentialHash:
      observedSecret === null
        ? null
        : createHash('sha256').update(observedSecret).digest('hex'),
    apiUrl: options.apiUrl ?? config.endpoints?.api,
  });
  let result;
  try {
    result = options.signer
      ? await requestProofEnrollment({
          signer: options.signer,
          subjectId: config.subject_id,
          code: options.code,
          idempotencyKey: options.idempotencyKey,
          expectedTeamId: replacementTeam,
          apiUrl: options.apiUrl ?? config.endpoints?.api,
        })
      : await options.agent!.teams.join(options.code, {
          issueAgentKey: true,
          idempotencyKey: options.idempotencyKey,
        });
  } catch (error) {
    throw new EnrollmentRecoveryError(
      await recovery.retain(),
      error instanceof EnrollmentRequestError || error instanceof MoltNetError
        ? error.issuedKeyId
        : undefined,
      error instanceof EnrollmentRequestError || error instanceof MoltNetError
        ? error.statusCode
        : undefined,
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
            issued.key.teamId !== result.teamId
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
