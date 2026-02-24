/**
 * E2E: LeGreffier Onboarding Endpoints
 *
 * Tests the unauthenticated LeGreffier onboarding endpoints.
 * The full happy path requires a live GitHub interaction and is exercised
 * manually / in integration. These tests cover the observable contract:
 * validation errors and expected failures without SPONSOR_AGENT_ID.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestHarness, type TestHarness } from './setup.js';

const VALID_PUBLIC_KEY = 'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=';
const VALID_FINGERPRINT = 'C212-DAFA-27C5-6C57';

describe('LeGreffier onboarding', () => {
  let harness: TestHarness;
  let baseUrl: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    baseUrl = harness.baseUrl;
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  describe('POST /public/legreffier/start', () => {
    it('returns 400 on missing publicKey', async () => {
      const res = await fetch(`${baseUrl}/public/legreffier/start`, {
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
      const res = await fetch(`${baseUrl}/public/legreffier/start`, {
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
      const res = await fetch(`${baseUrl}/public/legreffier/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: VALID_PUBLIC_KEY,
          fingerprint: VALID_FINGERPRINT,
        }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 503 SERVICE_UNAVAILABLE when SPONSOR_AGENT_ID is not configured', async () => {
      const res = await fetch(`${baseUrl}/public/legreffier/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: VALID_PUBLIC_KEY,
          fingerprint: VALID_FINGERPRINT,
          agentName: 'my-bot',
        }),
      });

      expect(res.status).toBe(503);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('SERVICE_UNAVAILABLE');
    });
  });

  describe('GET /public/legreffier/callback', () => {
    it('returns 400 when code param is missing', async () => {
      const res = await fetch(
        `${baseUrl}/public/legreffier/callback?state=some-workflow-id`,
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when state param is missing', async () => {
      const res = await fetch(
        `${baseUrl}/public/legreffier/callback?code=github-code`,
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown workflowId', async () => {
      const res = await fetch(
        `${baseUrl}/public/legreffier/callback?code=github-code&state=unknown-workflow-id`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('GET /public/legreffier/status/:workflowId', () => {
    it('returns 404 for unknown workflowId', async () => {
      const res = await fetch(
        `${baseUrl}/public/legreffier/status/unknown-workflow-id`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('GET /public/legreffier/installed', () => {
    it('returns 400 when wf param is missing', async () => {
      const res = await fetch(
        `${baseUrl}/public/legreffier/installed?installation_id=12345`,
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when installation_id param is missing', async () => {
      const res = await fetch(
        `${baseUrl}/public/legreffier/installed?wf=some-workflow-id`,
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown workflowId', async () => {
      const res = await fetch(
        `${baseUrl}/public/legreffier/installed?wf=unknown-workflow-id&installation_id=12345`,
      );
      expect(res.status).toBe(404);
    });
  });
});
