/**
 * E2E: Health endpoint
 */

import { type Client, createClient, getHealth } from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createTestHarness,
  isDatabaseAvailable,
  type TestHarness,
} from './setup.js';

describe('GET /health', async () => {
  const available = await isDatabaseAvailable();
  if (!available) {
    it.skip('database not available — run `pnpm run docker:up`', () => {});
    return;
  }

  let harness: TestHarness;
  let client: Client;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('returns status ok', async () => {
    const { data, error } = await getHealth({ client });

    expect(error).toBeUndefined();
    expect(data).toBeDefined();
    expect(data!.status).toBe('ok');
    expect(data!.timestamp).toBeDefined();
  });
});
