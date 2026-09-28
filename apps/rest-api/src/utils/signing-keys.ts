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
 * Verify a signing request's signature against the identity key the signing
 * workflow checked it with. The workflow records that key on the request, so
 * a recorded result and a later verification always agree, even when a
 * rotation commits between the check and completion. Requests completed
 * before the key was recorded fall back to the key valid at `completedAt`,
 * then to the agent's current key when it has no recorded history.
 *
 * Returns the fingerprint of the key that verified, or null.
 */
export async function verifyWithSigningKeys(
  deps: KeyDeps,
  agent: Agent,
  signingRequest: Pick<SigningRequest, 'completedAt' | 'signerPublicKey'>,
  verify: (publicKey: string) => Promise<boolean>,
): Promise<string | null> {
  const candidates = await signingKeyCandidates(deps, agent, signingRequest);
  for (const key of candidates) {
    if (await verify(key.publicKey)) return key.fingerprint;
  }
  return null;
}

type KeyCandidate = { publicKey: string; fingerprint: string };

async function signingKeyCandidates(
  deps: KeyDeps,
  agent: Agent,
  signingRequest: Pick<SigningRequest, 'completedAt' | 'signerPublicKey'>,
): Promise<KeyCandidate[]> {
  const current = {
    publicKey: agent.publicKey,
    fingerprint: agent.fingerprint,
  };
  const { signerPublicKey } = signingRequest;
  if (signerPublicKey) {
    // Only a key this agent has held can vouch for its request.
    if (signerPublicKey === agent.publicKey) return [current];
    const history = await deps.agentIdentityKeyRepository.listForAgent(
      agent.id,
    );
    return history.filter((key) => key.publicKey === signerPublicKey);
  }
  const completedAt = signingRequest.completedAt ?? new Date();
  const keys = await deps.agentIdentityKeyRepository.findKeysValidBetween(
    agent.id,
    completedAt,
    completedAt,
  );
  return keys.length > 0 ? keys : [current];
}
