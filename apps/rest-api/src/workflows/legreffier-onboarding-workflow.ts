/**
 * LeGreffier Onboarding Durable Workflow
 *
 * DBOS workflow for one-command agent onboarding via GitHub App.
 *
 * Steps:
 * 1. Issue sponsor voucher
 * 2. Register agent (reuses registrationWorkflow.registerAgent)
 * 3. Wait for GitHub OAuth callback (recv github_code)  — 10 min
 * 4. If timeout: compensate (delete Kratos identity)
 * 5. Signal github_code_ready (for status polling)
 * 6. Wait for GitHub installation callback (recv installation_id) — 1 hour
 * 7. If timeout: compensate (delete Kratos identity)
 * 8. Return result
 *
 * ## Initialization Order
 *
 * Call `initLegreffierOnboardingWorkflow()` after configureDBOS(), before launchDBOS().
 * Call `setLegreffierOnboardingDeps()` in afterLaunch.
 */

import { DBOS, type VoucherRepository } from '@moltnet/database';
import type { IdentityApi } from '@ory/client-fetch';

import {
  type RegistrationResult,
  registrationWorkflow,
} from './registration-workflow.js';

// ── Constants ──────────────────────────────────────────────────

export const GITHUB_CODE_EVENT = 'github_code';
export const GITHUB_CODE_READY_EVENT = 'github_code_ready';
export const AWAITING_INSTALLATION_EVENT = 'awaiting_installation';
export const INSTALLATION_ID_EVENT = 'installation_id';
const GITHUB_CALLBACK_TIMEOUT_S = 600; // 10 minutes
const INSTALLATION_TIMEOUT_S = 3600; // 1 hour

// ── Error Classes ──────────────────────────────────────────────

export class OnboardingTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingTimeoutError';
  }
}

export class OnboardingWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingWorkflowError';
  }
}

// ── Types ──────────────────────────────────────────────────────

export interface LegreffierOnboardingDeps {
  voucherRepository: VoucherRepository;
  identityApi: IdentityApi;
}

export interface OnboardingResult extends RegistrationResult {
  workflowId: string;
  installationId: string;
}

// ── Dependency Injection ───────────────────────────────────────

let deps: LegreffierOnboardingDeps | null = null;

export function setLegreffierOnboardingDeps(d: LegreffierOnboardingDeps): void {
  deps = d;
}

function getDeps(): LegreffierOnboardingDeps {
  if (!deps) {
    throw new Error(
      'LeGreffier onboarding deps not set. Call setLegreffierOnboardingDeps() ' +
        'before using onboarding workflows.',
    );
  }
  return deps;
}

// ── Lazy Registration ──────────────────────────────────────────

type StartOnboardingFn = (
  publicKey: string,
  fingerprint: string,
  sponsorAgentId: string,
  agentName: string, // durably recorded for CLI git config integration
) => Promise<OnboardingResult>;

let _workflow: StartOnboardingFn | null = null;

/**
 * Initialize and register the LeGreffier onboarding workflow with DBOS.
 *
 * Must be called AFTER configureDBOS() and BEFORE launchDBOS().
 * Idempotent — safe to call multiple times.
 */
export function initLegreffierOnboardingWorkflow(): void {
  if (_workflow) return;

  // ── Steps ────────────────────────────────────────────────────

  const issueVoucherStep = DBOS.registerStep(
    async (sponsorAgentId: string): Promise<string> => {
      const { voucherRepository } = getDeps();
      const voucher = await voucherRepository.issueUnlimited(sponsorAgentId);
      return voucher.code;
    },
    {
      name: 'legreffier.step.issueVoucher',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const deleteKratosIdentityStep = DBOS.registerStep(
    async (identityId: string): Promise<void> => {
      const { identityApi } = getDeps();
      await identityApi.deleteIdentity({ id: identityId });
    },
    {
      name: 'legreffier.step.deleteKratosIdentity',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  // ── Workflow ─────────────────────────────────────────────────

  _workflow = DBOS.registerWorkflow(
    async (
      publicKey: string,
      fingerprint: string,
      sponsorAgentId: string,
      // agentName is durably recorded by DBOS as a workflow argument so it
      // survives restarts; the CLI integration will use it for git config.

      _agentName: string,
    ): Promise<OnboardingResult> => {
      const workflowId = DBOS.workflowID ?? 'unknown';

      // Step 1: Issue voucher from sponsor
      const voucherCode = await issueVoucherStep(sponsorAgentId);

      // Step 2: Register agent (Kratos + Keto + OAuth2 client)
      // startWorkflow + getResult is the correct DBOS pattern for calling a
      // child workflow from a parent workflow. DBOS records the child handle
      // and resumes from there on replay.
      const registrationHandle = await DBOS.startWorkflow(
        registrationWorkflow.registerAgent,
      )(publicKey, fingerprint, voucherCode);
      const registration = await registrationHandle.getResult();

      // Step 3: Wait for GitHub OAuth callback
      const githubCode = await DBOS.recv<string>(
        GITHUB_CODE_EVENT,
        GITHUB_CALLBACK_TIMEOUT_S,
      );

      if (!githubCode) {
        // Compensation: delete Kratos identity on timeout
        DBOS.logger.error(
          `LeGreffier onboarding timed out waiting for GitHub callback ` +
            `(workflowId=${workflowId}, identityId=${registration.identityId}). ` +
            `Compensating.`,
        );
        try {
          await deleteKratosIdentityStep(registration.identityId);
        } catch (err) {
          DBOS.logger.error(
            `Compensation failed: could not delete Kratos identity ` +
              `(identityId=${registration.identityId}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        throw new OnboardingTimeoutError(
          'Timed out waiting for GitHub App creation callback',
        );
      }

      // Step 4: Signal github_code_ready for status polling
      await DBOS.setEvent(GITHUB_CODE_READY_EVENT, githubCode);

      // Step 5: Signal awaiting_installation so the status endpoint can
      // distinguish "waiting for code" from "waiting for installation"
      await DBOS.setEvent(AWAITING_INSTALLATION_EVENT, true);

      // Step 6: Wait for GitHub installation callback (setup_url fires after repo selection)
      const installationId = await DBOS.recv<string>(
        INSTALLATION_ID_EVENT,
        INSTALLATION_TIMEOUT_S,
      );

      if (!installationId) {
        // Compensation: delete Kratos identity on installation timeout
        DBOS.logger.error(
          `LeGreffier onboarding timed out waiting for GitHub installation ` +
            `(workflowId=${workflowId}, identityId=${registration.identityId}). ` +
            `Compensating.`,
        );
        try {
          await deleteKratosIdentityStep(registration.identityId);
        } catch (err) {
          DBOS.logger.error(
            `Compensation failed: could not delete Kratos identity ` +
              `(identityId=${registration.identityId}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        throw new OnboardingTimeoutError(
          'Timed out waiting for GitHub App installation',
        );
      }

      return { ...registration, workflowId, installationId };
    },
    { name: 'legreffier.startOnboarding' },
  );
}

// ── Exported Collection ────────────────────────────────────────

export const legreffierOnboardingWorkflow = {
  get startOnboarding() {
    if (!_workflow) {
      throw new Error(
        'LeGreffier onboarding workflow not initialized. ' +
          'Call initLegreffierOnboardingWorkflow() after configureDBOS().',
      );
    }
    return _workflow;
  },
};
