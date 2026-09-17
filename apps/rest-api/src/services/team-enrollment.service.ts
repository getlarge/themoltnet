import { createHash } from 'node:crypto';

import type { AgentKeyService } from '@moltnet/agent-key-service';
import { KetoNamespace } from '@moltnet/auth';
import type { TeamRepository } from '@moltnet/database';
import type { FastifyBaseLogger } from 'fastify';

import { createProblem } from '../problems/index.js';
import { teamInviteWorkflow } from '../workflows/team-invite-workflow.js';

/** Talos returns the secret directly to this request; DBOS never sees it. */
export async function enrollTeamAgent(
  app: {
    teamRepository: Pick<TeamRepository, 'findInviteByCode' | 'findById'>;
    log: FastifyBaseLogger;
  },
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
  // Bind DBOS replay to the original code without persisting that bearer secret.
  const codeHash = createHash('sha256').update(input.code).digest('hex');
  let grant = await teamInviteWorkflow.findEnrollment(
    input.subjectId,
    input.idempotencyKey,
  );
  if (!grant) {
    const invite = await app.teamRepository.findInviteByCode(input.code);
    if (!invite) throw createProblem('not-found', 'Invalid invite code');
    if (invite.expiresAt <= new Date()) throw createProblem('invite-expired');
    const team = await app.teamRepository.findById(invite.teamId);
    if (!team || team.personal)
      throw createProblem('not-found', 'Invalid invite code');
    if (team.status !== 'active') throw createProblem('team-not-active');
    grant = await teamInviteWorkflow.run({
      inviteId: invite.id,
      subjectId: input.subjectId,
      subjectNs: KetoNamespace.Agent,
      enrollment: { idempotencyKey: input.idempotencyKey, codeHash },
    });
  }
  // Concurrent starts with the same workflow ID return its original result.
  if (grant.enrollmentCodeHash !== codeHash) {
    throw createProblem(
      'conflict',
      'Idempotency-Key was reused with different input',
    );
  }
  const team = await app.teamRepository.findById(grant.teamId);
  if (!team || team.personal || team.status !== 'active')
    throw createProblem('team-not-active');
  const issued = await keys.issueEnrollment({
    grant: {
      inviteId: grant.inviteId,
      agentId: input.subjectId,
      teamId: grant.teamId,
    },
    logger: app.log,
    signal: input.signal,
  });
  if (!issued.secret) {
    throw createProblem(
      'conflict',
      'This enrollment already issued a key. Its original secret cannot be recovered; revoke it and use a fresh invitation.',
    );
  }
  return {
    teamId: grant.teamId,
    role: grant.role,
    agentKey: { key: issued.key, secret: issued.secret },
  };
}
