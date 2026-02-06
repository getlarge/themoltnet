/**
 * E2E: Concurrency tests
 *
 * Tests concurrent diary operations to verify atomicity and consistency
 * at the HTTP API level. These tests verify that Keto permissions are
 * immediately available after create/share operations complete.
 */

import {
  type Client,
  createClient,
  createDiaryEntry,
  deleteDiaryEntry,
  getDiaryEntry,
  shareDiaryEntry,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Concurrency and Atomicity', () => {
  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    agent = await createAgent({
      app: harness.app,
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Concurrent Creates ─────────────────────────────────────

  it('handles 10 concurrent creates without data loss', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      createDiaryEntry({
        client,
        auth: () => agent.accessToken,
        body: { content: `Concurrent entry ${i}` },
      }),
    );

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<(typeof promises)[0]>> =>
        r.status === 'fulfilled',
    );
    const successful = fulfilled.filter((r) => !r.value.error);

    expect(successful.length).toBe(10);
  });

  it('can read entry immediately after create (Keto permission available)', async () => {
    const { data: entry, error: createError } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: { content: 'Immediate read test' },
    });

    expect(createError).toBeUndefined();
    expect(entry).toBeDefined();

    // Immediately read back - Keto permission should already be granted
    const { data: fetched, error: readError } = await getDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { id: entry!.id },
    });

    expect(readError).toBeUndefined();
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(entry!.id);
  });

  // ── Concurrent Create/Delete ───────────────────────────────

  it('handles concurrent create then delete without orphans', async () => {
    // Create 5 entries
    const createPromises = Array.from({ length: 5 }, (_, i) =>
      createDiaryEntry({
        client,
        auth: () => agent.accessToken,
        body: { content: `Entry to delete ${i}` },
      }),
    );

    const createResults = await Promise.all(createPromises);
    const entries = createResults.map((r) => r.data!);

    // Concurrently delete all
    const deletePromises = entries.map((e) =>
      deleteDiaryEntry({
        client,
        auth: () => agent.accessToken,
        path: { id: e.id },
      }),
    );

    const deleteResults = await Promise.all(deletePromises);

    // All deletes should succeed
    for (const result of deleteResults) {
      expect(result.error).toBeUndefined();
    }

    // Verify all entries are gone
    for (const entry of entries) {
      const { data } = await getDiaryEntry({
        client,
        auth: () => agent.accessToken,
        path: { id: entry.id },
      });
      expect(data).toBeUndefined();
    }
  });

  // ── Sharing Atomicity ──────────────────────────────────────

  describe('sharing atomicity', () => {
    let agentB: TestAgent;

    beforeAll(async () => {
      const voucherCode = await createTestVoucher({
        db: harness.db,
        issuerId: harness.bootstrapIdentityId,
      });

      agentB = await createAgent({
        app: harness.app,
        baseUrl: harness.baseUrl,
        identityApi: harness.identityApi,
        hydraAdminOAuth2: harness.hydraAdminOAuth2,
        webhookApiKey: harness.webhookApiKey,
        voucherCode,
      });
    });

    it('grants Keto viewer permission immediately on share', async () => {
      // Agent A creates an entry
      const { data: entry } = await createDiaryEntry({
        client,
        auth: () => agent.accessToken,
        body: { content: 'Immediate share test' },
      });

      // Agent A shares with Agent B
      const { error: shareError } = await shareDiaryEntry({
        client,
        auth: () => agent.accessToken,
        path: { id: entry!.id },
        body: { sharedWith: agentB.keyPair.fingerprint },
      });

      expect(shareError).toBeUndefined();

      // Agent B should be able to read immediately (Keto permission granted)
      const { data: fetched, error: readError } = await getDiaryEntry({
        client,
        auth: () => agentB.accessToken,
        path: { id: entry!.id },
      });

      expect(readError).toBeUndefined();
      expect(fetched).toBeDefined();
      expect(fetched!.content).toBe('Immediate share test');
    });
  });
});
