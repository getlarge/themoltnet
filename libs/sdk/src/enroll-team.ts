import {
  agentKeyKey,
  assertAgentKeyReferenceBinding,
  assertCanonicalConfig,
  readConfig,
  resolveConfigDir,
  updateConfig,
} from '@moltnet/agent-config';
import type { TeamAgentKey } from '@moltnet/api-client';

import type { Agent } from './agent.js';
import { prepareCredentialPersistence } from './credential-persistence.js';
import type { SecretReference } from './credentials.js';
import type { SecretProvider } from './secrets.js';

export interface EnrollTeamOptions {
  /** Existing authenticated agent; no destination-team context is required. */
  agent: Pick<Agent, 'teams'>;
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
  const recovery = await prepareCredentialPersistence(dir);
  let result;
  try {
    result = await options.agent.teams.join(options.code, {
      issueAgentKey: true,
      idempotencyKey: options.idempotencyKey,
    });
  } catch (error) {
    await recovery.cancel();
    throw error;
  }
  const issued = result.agentKey;
  if (!issued) {
    await recovery.cancel();
    throw new Error('Enrollment did not return an agent key');
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
      keyId: issued.key.id,
    },
    (store) =>
      updateConfig(async (current) => {
        if (
          current.subject_id !== config.subject_id ||
          issued.key.agentId !== config.subject_id ||
          issued.key.bindingScope !== 'team' ||
          issued.key.teamId !== result.teamId
        ) {
          throw new Error(
            'Enrollment credential is not bound to the selected identity and team',
          );
        }
        await store();
        current.agent_key_refs = {
          ...current.agent_key_refs,
          [result.teamId]: reference,
        };
      }, dir),
  );
  return {
    teamId: result.teamId,
    role: result.role,
    key: issued.key as TeamAgentKey,
    reference,
  };
}
