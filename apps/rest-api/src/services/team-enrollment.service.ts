import { createHash } from 'node:crypto';

import type { AgentKeyService } from '@moltnet/agent-key-service';
import { KetoNamespace } from '@moltnet/auth';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import { teamEnrollmentWorkflow } from '../workflows/team-enrollment-workflow.js';

/** Secrets are deliberately returned only from this non-DBOS request path. */
export async function enrollTeamAgent(
  app: FastifyInstance,
  keys: AgentKeyService,
  input: {
    subjectId: string;
    subjectNs: KetoNamespace;
    code: string;
    idempotencyKey?: string;
    signal: AbortSignal;
  },
) {
  if (input.subjectNs !== KetoNamespace.Agent) {
    throw createProblem(
      'forbidden',
      'Only agents may request an enrollment key',
    );
  }
  if (!input.idempotencyKey?.trim()) {
    throw createProblem(
      'validation-failed',
      'Idempotency-Key is required when issueAgentKey is true',
    );
  }
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  const idempotencyHash = hash(input.idempotencyKey);
  const requestHash = hash(
    JSON.stringify(['moltnet:team-enrollment:v1', input.code, true]),
  );
  const prior = await app.teamEnrollmentRepository.findByRequest(
    input.subjectId,
    idempotencyHash,
  );
  if (prior && (prior.requestHash !== requestHash || prior.issuedKeyId)) {
    throw createProblem(
      'conflict',
      'Enrollment already completed or Idempotency-Key was reused with different input',
    );
  }
  // An accepted receipt is the grant. Deleting or expiring the invite later
  // must not strand an enrollment interrupted before membership/issuance.
  const inviteId =
    prior?.inviteId ??
    (await app.teamRepository.findInviteByCode(input.code))?.id;
  if (!inviteId) throw createProblem('not-found', 'Invalid invite code');
  let receipt;
  try {
    receipt = await teamEnrollmentWorkflow.run({
      agentId: input.subjectId,
      inviteId,
      idempotencyHash,
      requestHash,
    });
  } catch (error) {
    // DBOS restores errors from durable storage without preserving custom
    // prototypes, so classify only the exact domain messages we own.
    const reason = error instanceof Error ? error.message : '';
    switch (reason) {
      case 'Team enrollment: conflict':
        throw createProblem(
          'conflict',
          'Invitation already redeemed or conflicting enrollment request',
        );
      case 'Team enrollment: invalid-invite':
        throw createProblem('not-found', 'Invalid invite code');
      case 'Team enrollment: expired':
        throw createProblem('invite-expired');
      case 'Team enrollment: exhausted':
        throw createProblem('invite-exhausted');
      case 'Team enrollment: inactive-team':
        throw createProblem('team-not-active');
      default:
        throw error;
    }
  }
  const team = await app.teamRepository.findById(receipt.teamId);
  if (!team || team.personal || team.status !== 'active')
    throw createProblem('team-not-active');
  const issued = await keys.issueEnrollment({
    receipt,
    logger: app.log,
    signal: input.signal,
  });
  // Save identifiers even on a Talos replay whose original response was lost.
  // No secret is stored in the receipt or a workflow transaction checkpoint.
  await app.teamEnrollmentRepository.markIssued(receipt.id, issued.key.id);
  if (!issued.secret) {
    throw createProblem(
      'conflict',
      'This enrollment already issued a key. Its original secret cannot be recovered; revoke it and use a fresh invitation.',
    );
  }
  return {
    teamId: receipt.teamId,
    role: receipt.role!,
    agentKey: { key: issued.key, secret: issued.secret },
  };
}
