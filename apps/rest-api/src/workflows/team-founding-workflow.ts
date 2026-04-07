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
import { DBOS, type TeamRepository } from '@moltnet/database';

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

  const grantFoundingMembersStep = DBOS.registerStep(
    async (
      teamId: string,
      foundingMembers: FoundingMember[],
    ): Promise<void> => {
      const { relationshipWriter, teamRepository } = getDeps();
      for (const member of foundingMembers) {
        const ns =
          member.subjectNs === 'Human'
            ? KetoNamespace.Human
            : KetoNamespace.Agent;
        // Keto grant calls are idempotent: granting an already-existing tuple
        // is a no-op in Keto. This makes the step safe to retry on DBOS failure.
        if (member.role === 'owner') {
          await relationshipWriter.grantTeamOwners(
            teamId,
            member.subjectId,
            ns,
          );
        } else if (member.role === 'manager') {
          await relationshipWriter.grantTeamManagers(
            teamId,
            member.subjectId,
            ns,
          );
        } else {
          await relationshipWriter.grantTeamMembers(
            teamId,
            member.subjectId,
            ns,
          );
        }
        // createFoundingAcceptance uses ON CONFLICT DO NOTHING — idempotent on retry.
        await teamRepository.createFoundingAcceptance({
          teamId,
          subjectId: member.subjectId,
          subjectNs: member.subjectNs,
          role: member.role,
        });
      }
    },
    {
      name: 'team.founding.step.grantMembers',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const activateTeamStep = DBOS.registerStep(
    async (teamId: string): Promise<void> => {
      const { teamRepository } = getDeps();
      await teamRepository.updateStatus(teamId, 'active');
    },
    {
      name: 'team.founding.step.activate',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const archiveTeamStep = DBOS.registerStep(
    async (
      teamId: string,
      foundingMembers: FoundingMember[],
    ): Promise<void> => {
      const { teamRepository, relationshipWriter, logger } = getDeps();
      const archived = await teamRepository.updateStatus(teamId, 'archived');
      if (!archived) {
        // State machine guard returned null — team was not in 'founding' status.
        // Log at error so this surfaces in alerting; do not swallow silently.
        logger.error(
          { teamId },
          'team.founding.archive_failed — team was not in founding status',
        );
      }
      // Best-effort Keto cleanup — orphan tuples are safe because team IDs are
      // UUIDs and the team no longer exists in DB after archiving.
      for (const member of foundingMembers) {
        const ns =
          member.subjectNs === 'Human'
            ? KetoNamespace.Human
            : KetoNamespace.Agent;
        try {
          await relationshipWriter.removeTeamMemberRelation(
            teamId,
            member.subjectId,
            ns,
          );
        } catch (err) {
          // Logged at error so repeated failures surface in alerting
          logger.error(
            { teamId, subjectId: member.subjectId, err },
            'team.founding.archive_keto_cleanup_failed',
          );
        }
      }
    },
    {
      name: 'team.founding.step.archive',
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
      // Step 1: Grant Keto roles + seed acceptance rows
      await grantFoundingMembersStep(teamId, foundingMembers);

      // Step 2: Wait for all owners to accept — 7-day timeout
      const accepted = await DBOS.recv<true>(
        FOUNDING_ACCEPT_EVENT,
        FOUNDING_TIMEOUT_S,
      );

      if (!accepted) {
        // Timeout: archive team + clean up Keto
        const { logger } = getDeps();
        logger.warn({ teamId }, 'team.founding.timeout — archiving team');
        await archiveTeamStep(teamId, foundingMembers);
        throw new TeamFoundingTimeoutError(teamId);
      }

      // All owners accepted: activate
      await activateTeamStep(teamId);
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
