/**
 * Team Founding Workflow
 *
 * DBOS workflow for project team founding with acceptance.
 * Creates team in 'founding' status, grants Keto roles to all founding members,
 * then waits for all owners to accept. Activates team when all owners accept,
 * or archives it after 7-day deadline.
 *
 * Steps:
 * 1. Create team in DB in 'founding' status
 * 2. Grant Keto roles to all founding members (owners, managers)
 * 3. Seed foundingAcceptances rows for all founding members
 * 4. Wait for all-accepted event (DBOS.recv) — 7-day timeout
 * 5a. On timeout: archive team + remove Keto tuples
 * 5b. On accepted: set team status to 'active'
 *
 * Routes send the accept event via DBOS.send(workflowId, event, payload).
 */

import { KetoNamespace, type RelationshipWriter } from '@moltnet/auth';
import {
  DBOS,
  type TeamRepository,
  type TransactionRunner,
} from '@moltnet/database';

import type { Logger } from './logger.js';

// ── Constants ─────────────────────────────────────────────────

export const FOUNDING_ACCEPT_EVENT = 'team.founding.accepted';
const FOUNDING_TIMEOUT_S = 7 * 24 * 3600; // 7 days

// ── Error Classes ──────────────────────────────────────────────

export class TeamFoundingTimeoutError extends Error {
  constructor(teamId: string) {
    super(`Team founding timed out for team ${teamId}`);
    this.name = 'TeamFoundingTimeoutError';
  }
}

// ── Types ──────────────────────────────────────────────────────

export interface FoundingMember {
  subjectId: string;
  subjectNs: 'Agent' | 'Human';
  role: 'owner' | 'manager' | 'member';
}

export interface TeamFoundingDeps {
  teamRepository: TeamRepository;
  transactionRunner: TransactionRunner;
  relationshipWriter: RelationshipWriter;
  logger: Logger;
}

export interface TeamFoundingResult {
  teamId: string;
  status: 'active';
}

// ── Dependency Injection ───────────────────────────────────────

let deps: TeamFoundingDeps | null = null;

export function setTeamFoundingDeps(d: TeamFoundingDeps): void {
  deps = d;
}

function getDeps(): TeamFoundingDeps {
  if (!deps) {
    throw new Error(
      'Team founding deps not set. Call setTeamFoundingDeps() before using.',
    );
  }
  return deps;
}

// ── Lazy Registration ──────────────────────────────────────────

type FoundTeamFn = (
  teamId: string,
  creatorId: string,
  creatorNs: 'Agent' | 'Human',
  foundingMembers: FoundingMember[],
) => Promise<TeamFoundingResult>;

let _workflow: FoundTeamFn | null = null;

export function initTeamFoundingWorkflow(): void {
  if (_workflow) return;

  // ── Steps ──────────────────────────────────────────────────

  const grantFoundingMemberStep = DBOS.registerStep(
    async (teamId: string, member: FoundingMember): Promise<void> => {
      const { relationshipWriter } = getDeps();
      const ns =
        member.subjectNs === 'Human'
          ? KetoNamespace.Human
          : KetoNamespace.Agent;
      if (member.role === 'owner') {
        await relationshipWriter.grantTeamOwners(teamId, member.subjectId, ns);
      } else if (member.role === 'manager') {
        await relationshipWriter.grantTeamManagers(
          teamId,
          member.subjectId,
          ns,
        );
      } else {
        await relationshipWriter.grantTeamMembers(teamId, member.subjectId, ns);
      }
    },
    {
      name: 'team.founding.step.grantMember',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const removeFoundingMemberStep = DBOS.registerStep(
    async (teamId: string, member: FoundingMember): Promise<void> => {
      const ns =
        member.subjectNs === 'Human'
          ? KetoNamespace.Human
          : KetoNamespace.Agent;
      await getDeps().relationshipWriter.removeTeamMemberRelation(
        teamId,
        member.subjectId,
        ns,
      );
    },
    {
      name: 'team.founding.step.removeMember',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  // ── Workflow ─────────────────────────────────────────────────

  _workflow = DBOS.registerWorkflow(
    async (
      teamId: string,
      _creatorId: string,
      _creatorNs: 'Agent' | 'Human',
      foundingMembers: FoundingMember[],
    ): Promise<TeamFoundingResult> => {
      // Seed acceptance rows atomically, separately from external Keto calls.
      await getDeps().transactionRunner.runInTransaction(
        async () => {
          for (const member of foundingMembers) {
            await getDeps().teamRepository.createFoundingAcceptance({
              teamId,
              subjectId: member.subjectId,
              subjectNs: member.subjectNs,
              role: member.role,
            });
          }
        },
        { name: 'team.founding.tx.seedAcceptances' },
      );

      const grants = await Promise.allSettled(
        foundingMembers.map((member) =>
          grantFoundingMemberStep(teamId, member),
        ),
      );
      const grantFailures = grants
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        )
        .map((result): unknown => result.reason);
      if (grantFailures.length > 0) {
        throw new AggregateError(
          grantFailures,
          'Failed to grant one or more founding team memberships',
        );
      }

      // Step 2: Wait for all owners to accept — 7-day timeout
      const accepted = await DBOS.recv<true>(
        FOUNDING_ACCEPT_EVENT,
        FOUNDING_TIMEOUT_S,
      );

      if (!accepted) {
        // A last acceptance may have committed while its completion signal was
        // lost. Reconcile database truth before taking the destructive path.
        const allOwnersAccepted =
          await getDeps().transactionRunner.runInTransaction(
            async () => {
              const acceptances =
                await getDeps().teamRepository.listFoundingAcceptances(teamId);
              const owners = acceptances.filter(
                (acceptance) => acceptance.role === 'owner',
              );
              return (
                owners.length > 0 &&
                owners.every((acceptance) => acceptance.status === 'accepted')
              );
            },
            { name: 'team.founding.tx.recheckAcceptances' },
          );
        if (allOwnersAccepted) {
          await getDeps().transactionRunner.runInTransaction(
            async () => {
              await getDeps().teamRepository.updateStatus(teamId, 'active');
            },
            { name: 'team.founding.tx.activateAfterRecheck' },
          );
          return { teamId, status: 'active' };
        }
        // Timeout: archive team, then durably reconcile Keto.
        const { logger } = getDeps();
        logger.warn({ teamId }, 'team.founding.timeout — archiving team');
        await getDeps().transactionRunner.runInTransaction(
          async () => {
            const archived = await getDeps().teamRepository.updateStatus(
              teamId,
              'archived',
            );
            if (!archived) {
              throw new Error(
                `Team ${teamId} was no longer in founding status`,
              );
            }
          },
          { name: 'team.founding.tx.archive' },
        );
        const removals = await Promise.allSettled(
          foundingMembers.map((member) =>
            removeFoundingMemberStep(teamId, member),
          ),
        );
        const removalFailures = removals
          .filter(
            (result): result is PromiseRejectedResult =>
              result.status === 'rejected',
          )
          .map((result): unknown => result.reason);
        if (removalFailures.length > 0) {
          throw new AggregateError(
            removalFailures,
            'Failed to remove one or more founding team memberships',
          );
        }
        throw new TeamFoundingTimeoutError(teamId);
      }

      // All owners accepted: activate
      await getDeps().transactionRunner.runInTransaction(
        async () => {
          await getDeps().teamRepository.updateStatus(teamId, 'active');
        },
        { name: 'team.founding.tx.activate' },
      );
      return { teamId, status: 'active' };
    },
    { name: 'team.founding.foundTeam' },
  );
}

// ── Exported Collection ────────────────────────────────────────

export const teamFoundingWorkflow = {
  get foundTeam() {
    if (!_workflow) {
      throw new Error(
        'Team founding workflow not initialized. Call initTeamFoundingWorkflow().',
      );
    }
    return _workflow;
  },
};
