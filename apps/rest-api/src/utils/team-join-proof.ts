import { KetoNamespace } from '@moltnet/auth';
import { buildTeamEnrollmentMessage } from '@moltnet/models';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import { verifyRegistrationProof } from './registration-proof.js';

/** Authenticate only this join operation; never mint a general auth context. */
export async function verifyTeamJoinProof(
  app: FastifyInstance,
  input: {
    code: string;
    proof: { subjectId: string; signature: string };
    expectedTeamId?: string;
    issueAgentKey?: true;
    idempotencyKey?: string;
  },
  signal: AbortSignal,
) {
  if (!input.issueAgentKey || !input.idempotencyKey?.trim()) {
    throw createProblem(
      'validation-failed',
      'Signing proof requires issueAgentKey and Idempotency-Key',
    );
  }
  const subjectId = input.proof.subjectId;
  const agent = await app.agentRepository.findById(subjectId);
  if (!agent?.identityId || agent.id !== subjectId)
    throw createProblem('unauthorized');
  await verifyRegistrationProof(app.cryptoService, {
    publicKey: agent.publicKey,
    proof: input.proof.signature,
    message: buildTeamEnrollmentMessage({
      ...input,
      subjectId,
      idempotencyKey: input.idempotencyKey,
    }),
  });
  const identity = await app.identityApi.getIdentity(
    { id: agent.identityId },
    { signal },
  );
  if (identity.state !== 'active') throw createProblem('unauthorized');
  return { subjectId, subjectNs: KetoNamespace.Agent };
}
