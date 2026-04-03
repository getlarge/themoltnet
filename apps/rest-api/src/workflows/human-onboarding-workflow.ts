/**
 * Human Onboarding Durable Workflow
 *
 * DBOS workflow triggered by the after-login webhook when a human
 * logs in for the first time (identityId is null on the human record).
 *
 * Steps:
 * 1. Set identityId on human record
 * 2. Register human in Keto
 * 3. Create personal team + grant Keto owner tuple
 * 4. Create private diary + grant Keto diary-team tuple
 *
 * Compensation: if steps 2-4 fail, identityId is cleared so
 * onboarding retries on next login.
 *
 * ## Initialization Order
 *
 * Workflows are registered lazily via `initHumanOnboardingWorkflow()`.
 * This allows the module to be imported before DBOS is configured.
 * Call `initHumanOnboardingWorkflow()` first, then `setHumanOnboardingDeps()`.
 */

import { KetoNamespace, type RelationshipWriter } from '@moltnet/auth';
import {
  type DataSource,
  DBOS,
  type DiaryRepository,
  type HumanRepository,
  type TeamRepository,
} from '@moltnet/database';

import type { Logger } from './logger.js';

// ── Error Classes ──────────────────────────────────────────────

export class HumanOnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HumanOnboardingError';
  }
}

// ── Types ──────────────────────────────────────────────────────

export interface HumanOnboardingDeps {
  humanRepository: HumanRepository;
  diaryRepository: DiaryRepository;
  teamRepository: TeamRepository;
  relationshipWriter: RelationshipWriter;
  dataSource: DataSource;
  logger: Logger;
}

export interface HumanOnboardingResult {
  humanId: string;
  identityId: string;
  personalTeamId: string;
}

// ── Dependency Injection ───────────────────────────────────────

let deps: HumanOnboardingDeps | null = null;

export function setHumanOnboardingDeps(d: HumanOnboardingDeps): void {
  deps = d;
}

function getDeps(): HumanOnboardingDeps {
  if (!deps) {
    throw new Error(
      'Human onboarding deps not set. Call setHumanOnboardingDeps() ' +
        'before using onboarding workflows.',
    );
  }
  return deps;
}

// ── Lazy Registration ──────────────────────────────────────────

type OnboardHumanFn = (
  humanId: string,
  identityId: string,
  username: string,
) => Promise<HumanOnboardingResult>;

let _workflow: OnboardHumanFn | null = null;

/**
 * Initialize and register the human onboarding workflow with DBOS.
 *
 * Must be called AFTER configureDBOS() and setHumanOnboardingDeps(),
 * and BEFORE launchDBOS().
 * Idempotent — safe to call multiple times.
 */
export function initHumanOnboardingWorkflow(): void {
  if (_workflow) return;

  // ── Steps ──────────────────────────────────────────────────

  const setIdentityIdStep = DBOS.registerStep(
    async (humanId: string, identityId: string): Promise<void> => {
      const { humanRepository } = getDeps();
      const updated = await humanRepository.setIdentityId(humanId, identityId);
      if (!updated) {
        throw new HumanOnboardingError(`Human record ${humanId} not found`);
      }
    },
    {
      name: 'onboarding.step.setIdentityId',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 1,
      backoffRate: 2,
    },
  );

  const registerInKetoStep = DBOS.registerStep(
    async (identityId: string): Promise<void> => {
      const { relationshipWriter } = getDeps();
      await relationshipWriter.registerHuman(identityId);
    },
    {
      name: 'onboarding.step.registerInKeto',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const createPersonalTeamStep = DBOS.registerStep(
    async (identityId: string, username: string): Promise<string> => {
      const { teamRepository } = getDeps();
      const existing = await teamRepository.findPersonalByCreator(identityId);
      if (existing) return existing.id;

      const team = await teamRepository.create({
        name: username,
        personal: true,
        createdBy: identityId,
        status: 'active',
      });
      return team.id;
    },
    {
      name: 'onboarding.step.createPersonalTeam',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const grantTeamOwnerStep = DBOS.registerStep(
    async (teamId: string, identityId: string): Promise<void> => {
      const { relationshipWriter } = getDeps();
      // Keto PUT is idempotent — safe to retry
      await relationshipWriter.grantTeamOwners(
        teamId,
        identityId,
        KetoNamespace.Human,
      );
    },
    {
      name: 'onboarding.step.grantTeamOwner',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const createPrivateDiaryStep = DBOS.registerStep(
    async (identityId: string, personalTeamId: string): Promise<void> => {
      const { diaryRepository, relationshipWriter } = getDeps();
      const owned = await diaryRepository.listByCreator(identityId);
      const existing = owned.find((d) => d.name === 'Private');
      const diary =
        existing ??
        (await diaryRepository.create({
          createdBy: identityId,
          name: 'Private',
          visibility: 'private',
          teamId: personalTeamId,
        }));
      // Keto PUT is idempotent — safe to re-grant on retry
      await relationshipWriter.grantDiaryTeam(diary.id, personalTeamId);
    },
    {
      name: 'onboarding.step.createPrivateDiary',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  // ── Workflow ─────────────────────────────────────────────────

  _workflow = DBOS.registerWorkflow(
    async (
      humanId: string,
      identityId: string,
      username: string,
    ): Promise<HumanOnboardingResult> => {
      // Step 1: Link identity to human record
      await setIdentityIdStep(humanId, identityId);

      // Steps 2-4 have compensation: clear identityId on failure
      try {
        // Step 2: Register in Keto
        await registerInKetoStep(identityId);

        // Step 3: Create personal team
        const personalTeamId = await createPersonalTeamStep(
          identityId,
          username,
        );

        // Step 4: Grant team ownership
        await grantTeamOwnerStep(personalTeamId, identityId);

        // Step 5: Create private diary
        await createPrivateDiaryStep(identityId, personalTeamId);

        return { humanId, identityId, personalTeamId };
      } catch (error: unknown) {
        // Compensation: clear identityId so onboarding retries on next login
        const { logger, humanRepository } = getDeps();
        logger.error(
          { err: error, humanId, identityId },
          'onboarding.compensation_started',
        );

        try {
          await humanRepository.clearIdentityId(humanId);
        } catch (compensationError: unknown) {
          logger.error(
            { err: compensationError, humanId },
            'onboarding.compensation_failed',
          );
        }

        throw error;
      }
    },
    { name: 'onboarding.onboardHuman' },
  );
}

// ── Exported Collection ────────────────────────────────────────

export const humanOnboardingWorkflow = {
  get onboardHuman() {
    if (!_workflow) {
      throw new Error(
        'Human onboarding workflow not initialized. ' +
          'Call initHumanOnboardingWorkflow() after configureDBOS().',
      );
    }
    return _workflow;
  },
};
