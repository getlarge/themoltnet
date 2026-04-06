/**
 * E2E: Session-Based Authentication (X-Moltnet-Session-Token)
 *
 * Tests the Kratos session auth path added for the console app.
 * Uses X-Moltnet-Session-Token header instead of Bearer token.
 *
 * Requires: Docker Compose e2e stack running
 */

import { createClient, listDiaries } from '@moltnet/api-client';
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

  function createSessionClient(sessionToken: string) {
    const client = createClient({ baseUrl: harness.baseUrl });
    client.interceptors.request.use((request) => {
      request.headers.set('X-Moltnet-Session-Token', sessionToken);
      return request;
    });
    return client;
  }

  // ── Session Auth on Protected Endpoints ──────────────────────

  describe('X-Moltnet-Session-Token authentication', () => {
    it('authenticates and lists diaries via session token', async () => {
      const client = createSessionClient(human.sessionToken);
      const { data, error } = await listDiaries({ client });

      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.items).toBeDefined();
      expect(Array.isArray(data!.items)).toBe(true);
    });

    it('returns 401 with invalid session token and no Bearer', async () => {
      const client = createSessionClient('invalid-session-token-xyz');
      const { error } = await listDiaries({ client });

      expect(error).toBeDefined();
    });

    it('works with session token and team header', async () => {
      const client = createSessionClient(human.sessionToken);
      const { data } = await listDiaries({ client });

      expect(data).toBeDefined();
      const privateDiary = data!.items.find(
        (d: { name: string }) => d.name === 'Private',
      );

      if ((privateDiary as { teamId?: string })?.teamId) {
        const teamClient = createSessionClient(human.sessionToken);
        teamClient.interceptors.request.use((request) => {
          request.headers.set(
            'x-moltnet-team-id',
            (privateDiary as { teamId: string }).teamId,
          );
          return request;
        });
        const { data: teamData, error: teamError } = await listDiaries({
          client: teamClient,
        });

        expect(teamError).toBeUndefined();
        expect(teamData).toBeDefined();
      }
    });

    it('rejects access to non-member team via session token', async () => {
      const client = createSessionClient(human.sessionToken);
      client.interceptors.request.use((request) => {
        request.headers.set(
          'x-moltnet-team-id',
          '00000000-0000-4000-b000-000000000099',
        );
        return request;
      });

      const { error } = await listDiaries({ client });

      expect(error).toBeDefined();
    });
  });
});
