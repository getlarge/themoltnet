import type { Agent, SigningRequest } from '@moltnet/database';
import type { FastifyInstance } from 'fastify';

type KeyDeps = Pick<
  FastifyInstance,
  'agentRepository' | 'agentIdentityKeyRepository'
>;

/**
 * Resolve a fingerprint to its agent, whether it names the agent's current
 * identity key or one the agent has rotated away from.
 */
export async function findAgentByAnyFingerprint(
  deps: KeyDeps,
  fingerprint: string,
): Promise<Agent | null> {
  const current = await deps.agentRepository.findByFingerprint(fingerprint);
  if (current) return current;
  const retired =
    await deps.agentIdentityKeyRepository.findByFingerprint(fingerprint);
  return retired ? deps.agentRepository.findById(retired.agentId) : null;
}

/**
 * Verify a signing request's signature against the identity key(s) the agent
 * held while the request was open. Almost always one key; two when the agent
 * rotated between the request's creation and its completion. The agent's
 * current key is the fallback for an agent with no recorded history.
 *
 * Returns the fingerprint of the key that verified, or null.
 */
export async function verifyWithSigningKeys(
  deps: KeyDeps,
  agent: Agent,
  signingRequest: Pick<SigningRequest, 'createdAt' | 'completedAt'>,
  verify: (publicKey: string) => Promise<boolean>,
): Promise<string | null> {
  const keys = await deps.agentIdentityKeyRepository.findKeysValidBetween(
    agent.id,
    signingRequest.createdAt,
    signingRequest.completedAt ?? new Date(),
  );
  const candidates =
    keys.length > 0
      ? keys
      : [{ publicKey: agent.publicKey, fingerprint: agent.fingerprint }];
  for (const key of candidates) {
    if (await verify(key.publicKey)) return key.fingerprint;
  }
  return null;
}
