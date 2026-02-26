/**
 * E2E: LeGreffier Onboarding Endpoints
 *
 * Tests the unauthenticated LeGreffier onboarding endpoints.
 *
 * Validation / error tests: always available.
 *
 * Happy path: requires globalSetup to have bootstrapped a sponsor genesis
 * agent and restarted rest-api with SPONSOR_AGENT_ID set.
 * Note: the server does NOT call GitHub — /callback and /installed simply
 * forward data to the DBOS workflow via DBOS.send/recv. No mocking needed.
 */

import type {
  Client,
  GetLegreffierOnboardingStatusResponse,
  StartLegreffierOnboardingResponse,
} from '@moltnet/api-client';
import {
  createClient,
  getLegreffierOnboardingStatus,
  startLegreffierOnboarding,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestHarness, type TestHarness } from './setup.js';

const VALID_PUBLIC_KEY = 'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=';
const VALID_FINGERPRINT = 'C212-DAFA-27C5-6C57';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Poll /status until the workflow reaches a terminal or target state. */
async function pollStatus(
  client: Client,
  workflowId: string,
  targetStatus: GetLegreffierOnboardingStatusResponse['status'],
  maxAttempts = 30,
  intervalMs = 1000,
): Promise<GetLegreffierOnboardingStatusResponse> {
  for (let i = 0; i < maxAttempts; i++) {
    const { data, error } = await getLegreffierOnboardingStatus({
      client,
      path: { workflowId },
    });
    if (error) throw new Error(`Status poll error: ${JSON.stringify(error)}`);
    if (
      data.status === targetStatus ||
      data.status === 'completed' ||
      data.status === 'failed'
    ) {
      return data;
    }
    await new Promise<void>((r) => {
      setTimeout(r, intervalMs);
    });
  }
  throw new Error(
    `Workflow ${workflowId} did not reach "${targetStatus}" after ${maxAttempts} attempts`,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('LeGreffier onboarding', () => {
  let harness: TestHarness;
  let client: Client;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  describe('POST /public/legreffier/start', () => {
    it('returns 400 on missing publicKey', async () => {
      const res = await fetch(`${harness.baseUrl}/public/legreffier/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fingerprint: VALID_FINGERPRINT,
          agentName: 'my-bot',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 on missing fingerprint', async () => {
      const res = await fetch(`${harness.baseUrl}/public/legreffier/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: VALID_PUBLIC_KEY,
          agentName: 'my-bot',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 on missing agentName', async () => {
      const res = await fetch(`${harness.baseUrl}/public/legreffier/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: VALID_PUBLIC_KEY,
          fingerprint: VALID_FINGERPRINT,
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /public/legreffier/callback', () => {
    it('returns 400 when code param is missing', async () => {
      const res = await fetch(
        `${harness.baseUrl}/public/legreffier/callback?state=some-workflow-id`,
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when state param is missing', async () => {
      const res = await fetch(
        `${harness.baseUrl}/public/legreffier/callback?code=github-code`,
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown workflowId', async () => {
      const res = await fetch(
        `${harness.baseUrl}/public/legreffier/callback?code=github-code&state=unknown-workflow-id`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('GET /public/legreffier/status/:workflowId', () => {
    it('returns 404 for unknown workflowId', async () => {
      const { error } = await getLegreffierOnboardingStatus({
        client,
        path: { workflowId: 'unknown-workflow-id' },
      });
      expect(error).toBeDefined();
      expect((error as Record<string, unknown>)['status']).toBe(404);
    });
  });

  describe('GET /public/legreffier/installed', () => {
    it('returns 400 when wf param is missing', async () => {
      const res = await fetch(
        `${harness.baseUrl}/public/legreffier/installed?installation_id=12345`,
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when installation_id param is missing', async () => {
      const res = await fetch(
        `${harness.baseUrl}/public/legreffier/installed?wf=some-workflow-id`,
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown workflowId', async () => {
      const res = await fetch(
        `${harness.baseUrl}/public/legreffier/installed?wf=unknown-workflow-id&installation_id=12345`,
      );
      expect(res.status).toBe(404);
    });
  });

  // ── Happy path ───────────────────────────────────────────────────────────
  // Skipped when SPONSOR_AGENT_ID was not injected (e.g. bare `up` without globalSetup).

  describe('happy path (requires SPONSOR_AGENT_ID)', () => {
    it('full onboarding flow: start → callback → installed → completed', async () => {
      // Arrange
      const { data: startData, error: startError } =
        await startLegreffierOnboarding({
          client,
          body: {
            publicKey: VALID_PUBLIC_KEY,
            fingerprint: VALID_FINGERPRINT,
            agentName: 'e2e-test-bot',
          },
        });

      if (startError) {
        // SPONSOR_AGENT_ID not configured — globalSetup did not run or was skipped
        expect((startError as Record<string, unknown>)['status']).toBe(503);
        return;
      }

      const { workflowId } = startData as StartLegreffierOnboardingResponse;
      expect(workflowId).toBeTruthy();

      // Assert: initial status is awaiting_github
      const { data: initialStatus } = await getLegreffierOnboardingStatus({
        client,
        path: { workflowId },
      });
      expect(initialStatus!.status).toBe('awaiting_github');

      // Act: simulate GitHub OAuth callback (the server just forwards the code
      // to the DBOS workflow — no real GitHub interaction needed)
      const callbackRes = await fetch(
        `${harness.baseUrl}/public/legreffier/callback?code=fake-github-code&state=${workflowId}`,
      );
      expect(callbackRes.status).toBe(200);

      // Assert: status advances to awaiting_installation
      const afterCallback = await pollStatus(
        client,
        workflowId,
        'awaiting_installation',
      );
      expect(afterCallback.status).toBe('awaiting_installation');

      // Act: simulate GitHub installation callback
      const installedRes = await fetch(
        `${harness.baseUrl}/public/legreffier/installed?wf=${workflowId}&installation_id=99999`,
      );
      expect(installedRes.status).toBe(200);

      // Assert: workflow completes with credentials
      const final = await pollStatus(client, workflowId, 'completed');
      expect(final.status).toBe('completed');
      expect(final.identityId).toBeTruthy();
      expect(final.clientId).toBeTruthy();
      expect(final.clientSecret).toBeTruthy();
    });
  });
});
