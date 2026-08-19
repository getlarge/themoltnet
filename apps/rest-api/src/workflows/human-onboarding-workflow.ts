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
  DBOS,
  type DiaryRepository,
  type HumanRepository,
  type TeamRepository,
  type TransactionRunner,
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
  transactionRunner: TransactionRunner;
  relationshipWriter: RelationshipWriter;
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

  const grantPrivateDiaryStep = DBOS.registerStep(
    async (diaryId: string, personalTeamId: string): Promise<void> => {
      await getDeps().relationshipWriter.grantDiaryTeam(
        diaryId,
        personalTeamId,
      );
    },
    {
      name: 'onboarding.step.grantPrivateDiary',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const cleanupIdentityGrantsStep = DBOS.registerStep(
    async (
      identityId: string,
      personalTeamId: string | null,
    ): Promise<void> => {
      const { relationshipWriter } = getDeps();
      const cleanup: Promise<void>[] = [
        relationshipWriter.removeHumanRelations(identityId),
      ];
      if (personalTeamId) {
        cleanup.push(
          relationshipWriter.removeTeamMemberRelation(
            personalTeamId,
            identityId,
            KetoNamespace.Human,
          ),
        );
      }
      const results = await Promise.allSettled(cleanup);
      const failures = results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        )
        .map((result): unknown => result.reason);
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          'Human onboarding Keto compensation failed',
        );
      }
    },
    {
      name: 'onboarding.step.cleanupIdentityGrants',
      retriesAllowed: true,
      maxAttempts: 5,
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
      const {
        diaryRepository,
        humanRepository,
        teamRepository,
        transactionRunner,
      } = getDeps();

      await transactionRunner.runInTransaction(
        async () => {
          const updated = await humanRepository.bindIdentityId(
            humanId,
            identityId,
          );
          if (updated) return;
          const human = await humanRepository.findById(humanId);
          if (!human) {
            throw new HumanOnboardingError(`Human record ${humanId} not found`);
          }
          throw new HumanOnboardingError(
            `Human record ${humanId} is already bound to another identity`,
          );
        },
        { name: 'onboarding.tx.bindIdentity' },
      );

      // Steps 2-4 have compensation: clear identityId on failure
      let personalTeamId: string | null = null;
      try {
        // Step 2: Register in Keto
        await registerInKetoStep(identityId);

        // Step 3: Create personal team (FK target for creator_human_id is humans.id)
        const resolvedPersonalTeamId = await transactionRunner.runInTransaction(
          async () => {
            const existing = await teamRepository.findPersonalByCreator({
              kind: 'human',
              id: humanId,
            });
            if (existing) return existing.id;
            const team = await teamRepository.create({
              name: username,
              personal: true,
              creator: { kind: 'human', id: humanId },
              status: 'active',
            });
            return team.id;
          },
          { name: 'onboarding.tx.createPersonalTeam' },
        );
        personalTeamId = resolvedPersonalTeamId;

        // Step 4: Grant team ownership (Keto uses identityId)
        await grantTeamOwnerStep(resolvedPersonalTeamId, identityId);

        // Step 5: Create private diary (FK target for creator_human_id is humans.id)
        const privateDiaryId = await transactionRunner.runInTransaction(
          async () => {
            const existing = (
              await diaryRepository.listByCreator({
                kind: 'human',
                id: humanId,
              })
            ).find((diary) => diary.name === 'Private');
            if (existing) return existing.id;
            const diary = await diaryRepository.create({
              creator: { kind: 'human', id: humanId },
              name: 'Private',
              visibility: 'private',
              teamId: resolvedPersonalTeamId,
            });
            return diary.id;
          },
          { name: 'onboarding.tx.createPrivateDiary' },
        );
        await grantPrivateDiaryStep(privateDiaryId, resolvedPersonalTeamId);

        return { humanId, identityId, personalTeamId: resolvedPersonalTeamId };
      } catch (error: unknown) {
        // Compensation: clear identityId so onboarding retries on next login.
        // Wrapped in a registered DBOS step so a process crash mid-compensation
        // is replayed durably (rather than leaving the human row in a
        // partially-onboarded state).
        const { logger } = getDeps();
        logger.error(
          { err: error, humanId, identityId },
          'onboarding.compensation_started',
        );

        try {
          await cleanupIdentityGrantsStep(identityId, personalTeamId);
          await transactionRunner.runInTransaction(
            () => humanRepository.clearIdentityIdIfMatches(humanId, identityId),
            { name: 'onboarding.tx.compensateIdentityBinding' },
          );
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
