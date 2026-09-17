import {
  KetoNamespace,
  type RelationshipReader,
  type RelationshipWriter,
  teamRelationToRole,
  teamRoleRank,
} from '@moltnet/auth';
import {
  type ClaimTeamEnrollment,
  DBOS,
  type TeamEnrollment,
  TeamEnrollmentError,
  type TeamEnrollmentRepository,
  type TransactionRunner,
} from '@moltnet/database';

export interface TeamEnrollmentDeps {
  repository: TeamEnrollmentRepository;
  transactionRunner: TransactionRunner;
  relationshipReader: RelationshipReader;
  relationshipWriter: RelationshipWriter;
}
let deps: TeamEnrollmentDeps | undefined;
let workflow:
  | ((input: ClaimTeamEnrollment) => Promise<TeamEnrollment>)
  | undefined;

export function setTeamEnrollmentDeps(value: TeamEnrollmentDeps): void {
  deps = value;
}
function getDeps(): TeamEnrollmentDeps {
  if (!deps) throw new Error('Team enrollment dependencies not initialized');
  return deps;
}

export function initTeamEnrollmentWorkflow(): void {
  if (workflow) return;
  const grantMembership = DBOS.registerStep(
    async (receipt: TeamEnrollment) => {
      const { relationshipReader, relationshipWriter } = getDeps();
      const members = await relationshipReader.listTeamMembers(receipt.teamId);
      let existing: TeamEnrollment['role'];
      for (const member of members) {
        if (
          member.subjectNs !== 'Agent' ||
          member.subjectId !== receipt.agentId
        )
          continue;
        const role = teamRelationToRole(member.relation);
        if (!existing || teamRoleRank(role) > teamRoleRank(existing))
          existing = role;
      }
      // A fresh invite can enroll any existing member without changing their role.
      // This also reconciles a grant that succeeded before a process was killed.
      if (existing) return existing;
      switch (receipt.inviteRole) {
        case 'manager':
          await relationshipWriter.grantTeamManagers(
            receipt.teamId,
            receipt.agentId,
            KetoNamespace.Agent,
          );
          break;
        case 'executor':
          await relationshipWriter.grantTeamExecutors(
            receipt.teamId,
            receipt.agentId,
            KetoNamespace.Agent,
          );
          break;
        case 'member':
          await relationshipWriter.grantTeamMembers(
            receipt.teamId,
            receipt.agentId,
            KetoNamespace.Agent,
          );
          break;
      }
      return receipt.inviteRole;
    },
    {
      name: 'team.enrollment.grantMembership',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 1,
    },
  );

  workflow = DBOS.registerWorkflow(
    async (input: ClaimTeamEnrollment) => {
      const { repository, transactionRunner } = getDeps();
      const receipt = await transactionRunner.runInTransaction(
        () => repository.claim(input),
        {
          name: 'team.enrollment.claim',
        },
      );
      const role = await grantMembership(receipt);
      return { ...receipt, role };
    },
    { name: 'team.enrollment' },
  );
}

export const teamEnrollmentWorkflow = {
  /** Stable request identity deduplicates execution as well as invite use. */
  async run(input: ClaimTeamEnrollment): Promise<TeamEnrollment> {
    if (!workflow) throw new Error('Team enrollment workflow not initialized');
    const handle = await DBOS.startWorkflow(workflow, {
      workflowID: `team-enrollment:${input.agentId}:${input.idempotencyHash}`,
    })(input);
    const receipt = await handle.getResult();
    // DBOS deduplication returns the original result even if a caller reused
    // the workflow ID with different inputs. Reject that before issuance.
    if (
      receipt.requestHash !== input.requestHash ||
      receipt.id !== input.inviteId
    ) {
      throw new TeamEnrollmentError('conflict');
    }
    return receipt;
  },
};
