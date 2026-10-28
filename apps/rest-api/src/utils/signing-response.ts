import { buildSigningBytes } from '@moltnet/crypto-service';
import {
  type Agent,
  type Human,
  PrincipalAgentNotFoundError,
  PrincipalHumanNotFoundError,
  type PrincipalIdentity,
  type SigningRequest,
  type SigningRequester,
  signingRequester,
} from '@moltnet/database';
import type { FastifyInstance } from 'fastify';

export type PrincipalDeps = Pick<
  FastifyInstance,
  'agentRepository' | 'humanRepository'
>;

function requesterIdentity(
  requester: SigningRequester,
  agents: Map<string, Agent>,
  humans: Map<string, Human>,
): PrincipalIdentity {
  if (requester.kind === 'agent') {
    const agent = agents.get(requester.id);
    if (!agent) throw new PrincipalAgentNotFoundError(requester.id);
    return {
      kind: 'agent',
      agentId: agent.id,
      identityId: agent.identityId,
      fingerprint: agent.fingerprint,
      publicKey: agent.publicKey,
    };
  }
  const human = humans.get(requester.id);
  if (!human) throw new PrincipalHumanNotFoundError(requester.id);
  return { kind: 'human', humanId: human.id, identityId: human.identityId };
}

/** Shape rows for the API, resolving every requester in one query per kind. */
export async function toSigningResponses(
  rows: readonly SigningRequest[],
  deps: PrincipalDeps,
) {
  const requesters = rows.map(signingRequester);
  const idsOf = (kind: SigningRequester['kind']) =>
    requesters.filter((r) => r.kind === kind).map((r) => r.id);
  const [agents, humans] = await Promise.all([
    deps.agentRepository.findByIds(idsOf('agent')),
    deps.humanRepository.findByIds(idsOf('human')),
  ]);
  return rows.map((row, i) =>
    toSigningResponse(row, requesterIdentity(requesters[i], agents, humans)),
  );
}

export async function toSigningResponseOf(
  row: SigningRequest,
  deps: PrincipalDeps,
) {
  const [response] = await toSigningResponses([row], deps);
  return response;
}

function toSigningResponse(
  row: SigningRequest,
  requestedBy: PrincipalIdentity,
) {
  return {
    id: row.id,
    verificationMethod: row.verificationMethod,
    requestedBy,
    signerConstraint: row.signerConstraint ?? null,
    teamId: row.teamId ?? null,
    purpose: row.purpose ?? null,
    claimedByHumanId: row.claimedByHumanId ?? null,
    signingCredentialId: row.signingCredentialId ?? null,
    challenge: row.challenge ?? null,
    receipt: row.receipt ?? null,
    message: row.message,
    nonce: row.nonce,
    signingInput: Buffer.from(
      buildSigningBytes(row.message, row.nonce),
    ).toString('base64'),
    status: row.status,
    signature: row.signature,
    valid: row.valid,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
    claimedAt: row.claimedAt ?? null,
    rejectedAt: row.rejectedAt ?? null,
    rejectionReason: row.rejectionReason ?? null,
  };
}
