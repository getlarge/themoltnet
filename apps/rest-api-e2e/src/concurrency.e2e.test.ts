/**
 * E2E: Concurrency tests
 *
 * Tests concurrent diary and enrollment operations to verify atomicity and
 * consistency at the HTTP API level. These tests verify that Keto permissions
 * are immediately available after create/delete operations complete, and that
 * enrollment redemption races are properly handled.
 */

import { createHash, randomBytes } from 'node:crypto';

import {
  type Client,
  createClient,
  createDiaryEntry as apiCreateDiaryEntry,
  createTeam,
  createTeamInvite,
  deleteDiaryEntryById as apiDeleteDiaryEntryById,
  getDiaryEntryById as apiGetDiaryEntryById,
} from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import { buildTeamRegistrationMessage } from '@moltnet/models';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Concurrency and Atomicity', () => {
  function createDiaryEntry(
    args: Omit<Parameters<typeof apiCreateDiaryEntry<false>>[0], 'path'> & {
      path?: { diaryId?: string };
    },
  ) {
    return apiCreateDiaryEntry({
      ...args,
      path: { diaryId: args.path?.diaryId ?? agent.privateDiaryId },
    });
  }

  function getDiaryEntry(
    args: Omit<Parameters<typeof apiGetDiaryEntryById<false>>[0], 'path'> & {
      path: { entryId: string; diaryId?: string };
    },
  ) {
    return apiGetDiaryEntryById({
      ...args,
      path: {
        entryId: args.path.entryId,
      },
    });
  }

  function deleteDiaryEntry(
    args: Omit<Parameters<typeof apiDeleteDiaryEntryById<false>>[0], 'path'> & {
      path: { entryId: string; diaryId?: string };
    },
  ) {
    return apiDeleteDiaryEntryById({
      ...args,
      path: {
        entryId: args.path.entryId,
      },
    });
  }

  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    agent = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
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
      path: { entryId: entry!.id },
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
        path: { entryId: e.id },
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
        path: { entryId: entry.id },
      });
      expect(data).toBeUndefined();
    }
  });

  describe('concurrent team-invite registration', () => {
    it('allows only one agent to claim a single-use team invite', async () => {
      const { data: team, error: teamError } = await createTeam({
        client,
        auth: () => agent.accessToken,
        body: { name: `enrollment-race-${Date.now()}` },
      });
      expect(teamError).toBeUndefined();
      const { data: invite, error: inviteError } = await createTeamInvite({
        client,
        auth: () => agent.accessToken,
        path: { id: team!.id },
        body: { role: 'member', maxUses: 1, expiresInHours: 1 },
      });
      expect(inviteError).toBeUndefined();

      const keyPairA = await cryptoService.generateKeyPair();
      const keyPairB = await cryptoService.generateKeyPair();
      const tokenHash = createHash('sha256').update(invite!.code).digest('hex');
      const nonceA = randomBytes(32).toString('base64url');
      const nonceB = randomBytes(32).toString('base64url');
      const proofA = await cryptoService.sign(
        buildTeamRegistrationMessage({
          enrollmentTokenHash: tokenHash,
          idempotencyKey: nonceA,
          publicKey: keyPairA.publicKey,
          credentialType: 'oauth2',
        }),
        keyPairA.privateKey,
      );
      const proofB = await cryptoService.sign(
        buildTeamRegistrationMessage({
          enrollmentTokenHash: tokenHash,
          idempotencyKey: nonceB,
          publicKey: keyPairB.publicKey,
          credentialType: 'oauth2',
        }),
        keyPairB.privateKey,
      );
      const [respA, respB] = await Promise.all([
        fetch(`${harness.baseUrl}/auth/enroll`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': nonceA,
          },
          body: JSON.stringify({
            token: invite!.code,
            publicKey: keyPairA.publicKey,
            proof: proofA,
            credentialType: 'oauth2',
          }),
        }),
        fetch(`${harness.baseUrl}/auth/enroll`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': nonceB,
          },
          body: JSON.stringify({
            token: invite!.code,
            publicKey: keyPairB.publicKey,
            proof: proofB,
            credentialType: 'oauth2',
          }),
        }),
      ]);

      const statuses = [respA.status, respB.status].sort();
      expect(statuses[0]).toBe(200);
      expect([403, 502]).toContain(statuses[1]);
    });
  });
});
