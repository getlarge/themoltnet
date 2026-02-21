/**
 * E2E: Concurrency tests
 *
 * Tests concurrent diary and voucher operations to verify atomicity and
 * consistency at the HTTP API level. These tests verify that Keto permissions
 * are immediately available after create/delete operations complete, and that
 * voucher race conditions are properly handled.
 */

import {
  type Client,
  createClient,
  createDiaryEntry as apiCreateDiaryEntry,
  deleteDiaryEntry as apiDeleteDiaryEntry,
  getDiaryEntry as apiGetDiaryEntry,
  issueVoucher,
  listActiveVouchers,
} from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Concurrency and Atomicity', () => {
  function createDiaryEntry(
    args: Parameters<typeof apiCreateDiaryEntry>[0] & {
      path?: { diaryRef?: string };
    },
  ) {
    return apiCreateDiaryEntry({
      ...args,
      path: { diaryRef: args.path?.diaryRef ?? agent.privateDiaryId },
    });
  }

  function getDiaryEntry(
    args: Parameters<typeof apiGetDiaryEntry>[0] & {
      path: { id: string; diaryRef?: string };
    },
  ) {
    return apiGetDiaryEntry({
      ...args,
      path: {
        diaryRef: args.path.diaryRef ?? agent.privateDiaryId,
        id: args.path.id,
      },
    });
  }

  function deleteDiaryEntry(
    args: Parameters<typeof apiDeleteDiaryEntry>[0] & {
      path: { id: string; diaryRef?: string };
    },
  ) {
    return apiDeleteDiaryEntry({
      ...args,
      path: {
        diaryRef: args.path.diaryRef ?? agent.privateDiaryId,
        id: args.path.id,
      },
    });
  }

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

  // ── Concurrent Voucher Issuance ────────────────────────────

  describe('concurrent voucher issuance', () => {
    it(
      'enforces max-5 invariant under concurrent POST /vouch',
      { retry: 2 },
      async () => {
        // Create a fresh agent so its voucher count starts at 0
        const freshVoucher = await createTestVoucher({
          db: harness.db,
          issuerId: harness.bootstrapIdentityId,
        });
        const freshAgent = await createAgent({
          baseUrl: harness.baseUrl,
          identityApi: harness.identityApi,
          hydraAdminOAuth2: harness.hydraAdminOAuth2,
          webhookApiKey: harness.webhookApiKey,
          voucherCode: freshVoucher,
        });

        // Issue 4 vouchers sequentially
        for (let i = 0; i < 4; i++) {
          const { error } = await issueVoucher({
            client,
            auth: () => freshAgent.accessToken,
          });
          expect(error).toBeUndefined();
        }

        // Fire 3 concurrent issuance requests — at most 1 should succeed
        const responses = await Promise.all(
          Array.from({ length: 3 }, () =>
            issueVoucher({
              client,
              auth: () => freshAgent.accessToken,
            }),
          ),
        );

        const statuses = responses.map((r) => r.response.status);
        const succeeded = responses.filter((r) => r.response.status === 201);

        // The total active count should never exceed 5 — this is the critical invariant
        const { data: activeList } = await listActiveVouchers({
          client,
          auth: () => freshAgent.accessToken,
        });
        expect(activeList!.vouchers.length).toBeLessThanOrEqual(5);

        // At most 1 of the concurrent batch should have succeeded
        expect(succeeded.length).toBeLessThanOrEqual(1);
        // Every response must be either 201 (success) or 429 (rate-limited / serialization exhausted)
        // No 500s allowed — serialization exhaustion is now handled gracefully
        for (const status of statuses) {
          expect(
            status,
            `Unexpected status ${status} in concurrent voucher issuance (all statuses: ${statuses.join(', ')})`,
          ).toSatisfy((s: number) => s === 201 || s === 429);
        }
      },
    );
  });

  // ── Concurrent Voucher Redemption ─────────────────────────

  describe('concurrent voucher redemption', () => {
    it('only one agent registers with the same voucher code', async () => {
      // Create a single voucher
      const sharedVoucher = await createTestVoucher({
        db: harness.db,
        issuerId: harness.bootstrapIdentityId,
      });

      // Create two identities that will race to redeem the same voucher
      const keyPairA = await cryptoService.generateKeyPair();
      const keyPairB = await cryptoService.generateKeyPair();

      const identityA = await harness.identityApi.createIdentity({
        createIdentityBody: {
          schema_id: 'moltnet_agent',
          traits: {
            public_key: keyPairA.publicKey,
            voucher_code: sharedVoucher,
          },
          credentials: {
            password: { config: { password: 'e2e-race-agent-a' } },
          },
        },
      });

      const identityB = await harness.identityApi.createIdentity({
        createIdentityBody: {
          schema_id: 'moltnet_agent',
          traits: {
            public_key: keyPairB.publicKey,
            voucher_code: sharedVoucher,
          },
          credentials: {
            password: { config: { password: 'e2e-race-agent-b' } },
          },
        },
      });

      // Race: both call the after-registration webhook with the same voucher
      const [respA, respB] = await Promise.all([
        fetch(`${harness.baseUrl}/hooks/kratos/after-registration`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ory-api-key': harness.webhookApiKey,
          },
          body: JSON.stringify({
            identity: {
              id: identityA.id,
              traits: {
                public_key: keyPairA.publicKey,
                voucher_code: sharedVoucher,
              },
            },
          }),
        }),
        fetch(`${harness.baseUrl}/hooks/kratos/after-registration`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ory-api-key': harness.webhookApiKey,
          },
          body: JSON.stringify({
            identity: {
              id: identityB.id,
              traits: {
                public_key: keyPairB.publicKey,
                voucher_code: sharedVoucher,
              },
            },
          }),
        }),
      ]);

      const statuses = [respA.status, respB.status].sort();

      // Exactly one should succeed (200), the other should fail (403)
      expect(statuses).toEqual([200, 403]);
    });
  });
});
