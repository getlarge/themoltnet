import {
  KetoNamespace,
  type RelationshipReader,
  type RelationshipWriter,
  type TeamInviteRole,
  TeamRelation,
  type TeamRole,
} from '@moltnet/auth';
import {
  DBOS,
  type TeamRepository,
  type TransactionRunner,
} from '@moltnet/database';

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
interface TeamInviteDeps {
  teamRepository: TeamRepository;
  transactionRunner: TransactionRunner;
  relationshipReader: RelationshipReader;
  relationshipWriter: RelationshipWriter;
}
let deps: TeamInviteDeps;
let workflow: ((input: RedeemTeamInvite) => Promise<InviteResult>) | undefined;

export function setTeamInviteDeps(value: TeamInviteDeps): void {
  deps = value;
}

export function initTeamInviteWorkflow(): void {
  if (workflow) return;
  const grantMembership = DBOS.registerStep(
    async (input: RedeemTeamInvite, grant: InviteGrant) => {
      const { relationshipReader, relationshipWriter } = deps;
      const members = await relationshipReader.listTeamMembers(grant.teamId);
      if (
        members.some(
          (member) =>
            member.subjectId === input.subjectId &&
            member.subjectNs === String(input.subjectNs) &&
            member.relation === TeamRelation.Owners,
        )
      )
        return 'owner' as const;
      const relation = {
        manager: TeamRelation.Managers,
        executor: TeamRelation.Executors,
        member: TeamRelation.Members,
      }[grant.role];
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
          if (
            !invite ||
            (invite.role === 'executor' &&
              input.subjectNs === KetoNamespace.Human)
          )
            throw new Error('Team invite unavailable');
          const claimed = await deps.teamRepository.claimInvite(input.inviteId);
          if (!claimed) throw new Error('Team invite unavailable');
          // The invite consumption and this secret-free output share one DBOS transaction.
          return { teamId: claimed.teamId, role: claimed.role };
        },
        { name: 'team.invite.claim' },
      );
      const role = await grantMembership(input, grant);
      return { teamId: grant.teamId, role };
    },
    { name: 'team.invite.redeem' },
  );
}

export const teamInviteWorkflow = {
  async run(input: RedeemTeamInvite): Promise<InviteResult> {
    if (!workflow) throw new Error('Team invite workflow not initialized');
    const handle = await DBOS.startWorkflow(workflow, {
      workflowID: `team-invite:${input.inviteId}:${input.subjectNs}:${input.subjectId}`,
    })(input);
    return handle.getResult();
  },
};
