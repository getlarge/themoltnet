import {
  KetoNamespace,
  type RelationshipReader,
  type RelationshipWriter,
  type TeamInviteRole,
  TeamRelation,
  type TeamRole,
  teamRoleToRelation,
} from '@moltnet/auth';
import {
  DBOS,
  type TeamRepository,
  type TransactionRunner,
} from '@moltnet/database';

import { createProblem } from '../problems/index.js';

export interface RedeemTeamInvite {
  inviteId: string;
  subjectId: string;
  subjectNs: KetoNamespace;
}
interface InviteGrant {
  teamId: string;
  role: TeamInviteRole;
}
interface InviteResult {
  teamId: string;
  role: TeamRole;
}
type InviteRejection = {
  problem:
    | 'not-found'
    | 'forbidden'
    | 'invite-expired'
    | 'invite-exhausted'
    | 'team-not-active';
};
type InviteOutcome = InviteResult | InviteRejection;

function unwrapInviteOutcome(outcome: InviteOutcome): InviteResult {
  if ('problem' in outcome) throw createProblem(outcome.problem);
  return outcome;
}

interface TeamInviteDeps {
  teamRepository: TeamRepository;
  transactionRunner: TransactionRunner;
  relationshipReader: RelationshipReader;
  relationshipWriter: RelationshipWriter;
}
let deps: TeamInviteDeps;
let workflow: ((input: RedeemTeamInvite) => Promise<InviteOutcome>) | undefined;

export function setTeamInviteDeps(value: TeamInviteDeps): void {
  deps = value;
}

export function initTeamInviteWorkflow(): void {
  if (workflow) return;
  const grantMembership = DBOS.registerStep(
    async (input: RedeemTeamInvite, grant: InviteGrant) => {
      const { relationshipReader, relationshipWriter } = deps;
      const members = await relationshipReader.listTeamMembers(
        grant.teamId,
        input,
      );
      if (
        members.some(
          (member) =>
            member.subjectId === input.subjectId &&
            member.subjectNs === String(input.subjectNs) &&
            member.relation === TeamRelation.Owners,
        )
      )
        return 'owner' as const;
      const relation = teamRoleToRelation(grant.role);
      // Reconcile a Keto write that succeeded before its checkpoint was saved.
      if (
        members.some(
          (member) =>
            member.subjectId === input.subjectId &&
            member.subjectNs === String(input.subjectNs) &&
            member.relation === relation,
        )
      )
        return grant.role;
      switch (grant.role) {
        case 'manager':
          await relationshipWriter.grantTeamManagers(
            grant.teamId,
            input.subjectId,
            input.subjectNs,
          );
          break;
        case 'executor':
          await relationshipWriter.grantTeamExecutors(
            grant.teamId,
            input.subjectId,
            input.subjectNs,
          );
          break;
        case 'member':
          await relationshipWriter.grantTeamMembers(
            grant.teamId,
            input.subjectId,
            input.subjectNs,
          );
          break;
      }
      return grant.role;
    },
    {
      name: 'team.invite.grantMembership',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 1,
    },
  );

  workflow = DBOS.registerWorkflow(
    async (input: RedeemTeamInvite) => {
      const grant = await deps.transactionRunner.runInTransaction(
        async () => {
          const invite = await deps.teamRepository.findInviteById(
            input.inviteId,
          );
          if (!invite) return { problem: 'not-found' } as const;
          if (
            invite.role === 'executor' &&
            input.subjectNs === KetoNamespace.Human
          )
            return { problem: 'forbidden' } as const;
          if (invite.expiresAt <= new Date())
            return { problem: 'invite-expired' } as const;
          const team = await deps.teamRepository.findById(invite.teamId);
          if (!team || team.personal) return { problem: 'not-found' } as const;
          if (team.status !== 'active')
            return { problem: 'team-not-active' } as const;
          const claimed = await deps.teamRepository.claimInvite(input.inviteId);
          if (!claimed) {
            const current = await deps.teamRepository.findInviteById(
              input.inviteId,
            );
            if (!current) return { problem: 'not-found' } as const;
            if (current.expiresAt <= new Date())
              return { problem: 'invite-expired' } as const;
            const currentTeam = await deps.teamRepository.findById(
              current.teamId,
            );
            if (!currentTeam || currentTeam.personal)
              return { problem: 'not-found' } as const;
            if (currentTeam.status !== 'active')
              return { problem: 'team-not-active' } as const;
            return { problem: 'invite-exhausted' } as const;
          }
          // The invite consumption and this secret-free output share one DBOS transaction.
          return { teamId: claimed.teamId, role: claimed.role };
        },
        { name: 'team.invite.claim' },
      );
      // Expected rejections are durable data, not serialized Error subclasses.
      if ('problem' in grant) return grant;
      // Retry batches durably: a long Keto outage must not strand a claim in ERROR.
      for (;;) {
        try {
          const role = await grantMembership(input, grant);
          return { teamId: grant.teamId, role };
        } catch {
          DBOS.logger.warn({
            event: 'team_invite.membership_retry',
            workflowId: DBOS.workflowID,
            inviteId: input.inviteId,
            subjectId: input.subjectId,
            teamId: grant.teamId,
          });
          // Cancellation must propagate from this DBOS operation.
          await DBOS.sleepSeconds(30);
        }
      }
    },
    { name: 'team.invite.redeem' },
  );
}

function inviteWorkflowId(input: RedeemTeamInvite, attempt: number): string {
  const base = `team-invite:${input.inviteId}:${input.subjectNs}:${input.subjectId}`;
  return attempt ? `${base}:${attempt}` : base;
}

async function awaitInviteResult(id: string): Promise<InviteOutcome> {
  const outcome = await DBOS.getResult<InviteOutcome>(id, {
    timeoutSeconds: 10,
  });
  if (!outcome)
    throw createProblem(
      'service-unavailable',
      'Membership is still being reconciled; retry the same invitation',
    );
  return outcome;
}

export const teamInviteWorkflow = {
  // Only reconnect unfinished work. Completed joins still use the route's
  // current-membership checks, so replay cannot resurrect removed membership.
  async findPending(input: RedeemTeamInvite): Promise<InviteResult | null> {
    for (let attempt = 0; ; attempt++) {
      const id = inviteWorkflowId(input, attempt);
      const status = await DBOS.getWorkflowStatus(id);
      if (!status) return null;
      if (status.status === 'SUCCESS') {
        const outcome = await awaitInviteResult(id);
        if ('problem' in outcome) continue;
        return null;
      }
      return unwrapInviteOutcome(await awaitInviteResult(id));
    }
  },
  async run(input: RedeemTeamInvite): Promise<InviteResult> {
    if (!workflow)
      throw createProblem(
        'service-unavailable',
        'Team invite workflow is not ready',
      );
    for (let attempt = 0; ; attempt++) {
      const id = inviteWorkflowId(input, attempt);
      const status = await DBOS.getWorkflowStatus(id);
      if (status?.status === 'SUCCESS') {
        const outcome = await awaitInviteResult(id);
        // Rejected attempts had no side effects. A fresh validated request may
        // retry after registration compensation releases the invite.
        if ('problem' in outcome) continue;
        return outcome;
      }
      await DBOS.startWorkflow(workflow, { workflowID: id })(input);
      return unwrapInviteOutcome(await awaitInviteResult(id));
    }
  },
};
