/**
 * E2E: Problem type documentation routes (RFC 9457)
 *
 * Tests the public endpoints that document API error types.
 */

import {
  type Client,
  createClient,
  getProblemType,
  listProblemTypes,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestHarness, type TestHarness } from './setup.js';

describe('Problem Types', () => {
  let harness: TestHarness;
  let client: Client;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── List Problem Types ──────────────────────────────────────

  describe('GET /problems', () => {
    it('returns all registered problem types', async () => {
      const { data, error } = await listProblemTypes({ client });

      expect(error).toBeUndefined();
      expect(Array.isArray(data)).toBe(true);
      expect(data!.length).toBeGreaterThan(0);

      // Check that each entry has the expected shape
      for (const pt of data!) {
        const entry = pt as Record<string, unknown>;
        expect(entry.type).toBeDefined();
        expect(
          (entry.type as string).startsWith('https://themolt.net/problems/'),
        ).toBe(true);
        expect(entry.title).toBeDefined();
        expect(entry.status).toBeDefined();
        expect(entry.code).toBeDefined();
      }
    });

    it('includes common problem types', async () => {
      const { data } = await listProblemTypes({ client });

      const codes = (data! as Array<Record<string, unknown>>).map(
        (pt) => pt.code,
      );
      expect(codes).toContain('NOT_FOUND');
      expect(codes).toContain('UNAUTHORIZED');
    });
  });

  // ── Get Specific Problem Type ───────────────────────────────

  describe('GET /problems/:type', () => {
    it('returns details for a known problem type', async () => {
      const { data, error } = await getProblemType({
        client,
        path: { type: 'not-found' },
      });

      expect(error).toBeUndefined();
      const entry = data as Record<string, unknown>;
      expect(entry.type).toBe('https://themolt.net/problems/not-found');
      expect(entry.title).toBe('Not Found');
      expect(entry.status).toBe(404);
      expect(entry.code).toBe('NOT_FOUND');
    });

    it('returns 400 for unknown problem type', async () => {
      const { data, error, response } = await getProblemType({
        client,
        path: { type: 'nonexistent-problem' as never },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(400);
    });
  });
});
