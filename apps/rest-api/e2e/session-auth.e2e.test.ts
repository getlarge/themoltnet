/**
 * E2E: Session-Based Authentication (X-Session-Token)
 *
 * Tests the Kratos session auth path added for the dashboard app.
 * Uses X-Session-Token header instead of Bearer token.
 *
 * Requires: Docker Compose e2e stack running
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHuman, type TestHuman } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Session-Based Authentication E2E', { timeout: 60_000 }, () => {
  let harness: TestHarness;
  let human: TestHuman;

  beforeAll(async () => {
    harness = await createTestHarness();

    human = await createHuman({
      kratosPublicFrontend: harness.kratosPublicFrontend,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Session Auth on Protected Endpoints ──────────────────────

  describe('X-Session-Token authentication', () => {
    it('authenticates and lists diaries via session token', async () => {
      const resp = await fetch(`${harness.baseUrl}/diaries`, {
        headers: {
          'X-Session-Token': human.sessionToken,
        },
      });

      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.items).toBeDefined();
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('returns 401 with invalid session token and no Bearer', async () => {
      const resp = await fetch(`${harness.baseUrl}/diaries`, {
        headers: {
          'X-Session-Token': 'invalid-session-token-xyz',
        },
      });

      expect(resp.status).toBe(401);
    });

    it('ignores invalid session and falls through to Bearer', async () => {
      // Invalid session + no Bearer → 401
      const resp = await fetch(`${harness.baseUrl}/diaries`, {
        headers: {
          'X-Session-Token': 'invalid-session-token-xyz',
        },
      });

      expect(resp.status).toBe(401);
      const body = await resp.json();
      expect(body.message).toBe('Missing authorization header');
    });

    it('works with session token and team header', async () => {
      // First, get the diaries to find the personal team ID
      const diariesResp = await fetch(`${harness.baseUrl}/diaries`, {
        headers: {
          'X-Session-Token': human.sessionToken,
        },
      });

      expect(diariesResp.status).toBe(200);
      const diaries = await diariesResp.json();
      const privateDiary = diaries.items.find(
        (d: { name: string }) => d.name === 'Private',
      );

      if (privateDiary?.teamId) {
        // List diaries scoped to the personal team
        const teamResp = await fetch(`${harness.baseUrl}/diaries`, {
          headers: {
            'X-Session-Token': human.sessionToken,
            'x-moltnet-team-id': privateDiary.teamId,
          },
        });

        expect(teamResp.status).toBe(200);
      }
    });

    it('rejects access to non-member team via session token', async () => {
      const resp = await fetch(`${harness.baseUrl}/diaries`, {
        headers: {
          'X-Session-Token': human.sessionToken,
          'x-moltnet-team-id': '00000000-0000-4000-b000-000000000099',
        },
      });

      expect(resp.status).toBe(403);
    });
  });
});
