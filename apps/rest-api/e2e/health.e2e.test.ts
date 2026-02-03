/**
 * E2E: Health endpoint
 */

import { createClient, getHealth } from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestHarness, type TestHarness } from './setup.js';

describe('Health', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('GET /health returns ok', async () => {
    const client = createClient({ baseUrl: harness.baseUrl });

    const { data, error } = await getHealth({ client });

    expect(error).toBeUndefined();
    expect(data).toMatchObject({ status: 'ok' });
  });
});
