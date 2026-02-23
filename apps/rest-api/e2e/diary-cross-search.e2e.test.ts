/**
 * E2E: Cross-diary search with includeShared
 *
 * Tests that:
 * 1. includeShared:false returns only own entries
 * 2. Accepted shares are included with includeShared:true
 * 3. Pending/declined/revoked shares are NOT included
 * 4. Directionality: A shares to B ≠ B shares to A
 * 5. diaryId override ignores includeShared
 * 6. Third agent with no relationship sees nothing
 */

import {
  acceptDiaryInvitation,
  type Client,
  createClient,
  createDiaryEntry,
  declineDiaryInvitation,
  listDiaryInvitations,
  revokeDiaryShare,
  searchDiary,
  shareDiary,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Cross-diary search (includeShared)', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent;
  let agentB: TestAgent;
  let agentC: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    const [vA, vB, vC] = await Promise.all([
      createTestVoucher({
        db: harness.db,
        issuerId: harness.bootstrapIdentityId,
      }),
      createTestVoucher({
        db: harness.db,
        issuerId: harness.bootstrapIdentityId,
      }),
      createTestVoucher({
        db: harness.db,
        issuerId: harness.bootstrapIdentityId,
      }),
    ]);

    [agentA, agentB, agentC] = await Promise.all([
      createAgent({
        baseUrl: harness.baseUrl,
        identityApi: harness.identityApi,
        hydraAdminOAuth2: harness.hydraAdminOAuth2,
        webhookApiKey: harness.webhookApiKey,
        voucherCode: vA,
      }),
      createAgent({
        baseUrl: harness.baseUrl,
        identityApi: harness.identityApi,
        hydraAdminOAuth2: harness.hydraAdminOAuth2,
        webhookApiKey: harness.webhookApiKey,
        voucherCode: vB,
      }),
      createAgent({
        baseUrl: harness.baseUrl,
        identityApi: harness.identityApi,
        hydraAdminOAuth2: harness.hydraAdminOAuth2,
        webhookApiKey: harness.webhookApiKey,
        voucherCode: vC,
      }),
    ]);

    // Seed: A has an entry in A's diary
    await createDiaryEntry({
      client,
      auth: () => agentA.accessToken,
      path: { diaryId: agentA.privateDiaryId },
      body: { content: 'Agent A private memory', tags: ['agent-a'] },
    });

    // Seed: B has an entry in B's diary
    await createDiaryEntry({
      client,
      auth: () => agentB.accessToken,
      path: { diaryId: agentB.privateDiaryId },
      body: { content: 'Agent B private memory', tags: ['agent-b'] },
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Baseline: no shares ──────────────────────────────────────

  it('includeShared:false returns only own entries', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agentA.accessToken,
      body: { includeShared: false },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as { results: Array<{ tags: string[] | null }> }
    ).results;
    expect(results.every((r) => !r.tags || !r.tags.includes('agent-b'))).toBe(
      true,
    );
  });

  it('omitting includeShared defaults to own-only', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agentA.accessToken,
      body: {},
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as { results: Array<{ tags: string[] | null }> }
    ).results;
    expect(results.every((r) => !r.tags || !r.tags.includes('agent-b'))).toBe(
      true,
    );
  });

  // ── Share lifecycle ──────────────────────────────────────────

  describe('share lifecycle: A invites B to A diary', () => {
    let invitationId: string;

    it('pending share: B cannot see A entries with includeShared:true', async () => {
      // A shares A's diary with B
      const { data: shareData, error: shareError } = await shareDiary({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.privateDiaryId },
        body: { fingerprint: agentB.keyPair.fingerprint },
      });

      expect(shareError).toBeUndefined();
      invitationId = (shareData as unknown as { id: string }).id;

      // B searches with includeShared: true — share is still pending
      const { data } = await searchDiary({
        client,
        auth: () => agentB.accessToken,
        body: { includeShared: true },
      });

      const results = (
        data as unknown as { results: Array<{ tags: string[] | null }> }
      ).results;
      const hasAgentA = results.some(
        (r) => r.tags && r.tags.includes('agent-a'),
      );
      expect(hasAgentA).toBe(false);
    });

    it('accepted share: B can see A entries with includeShared:true', async () => {
      // B accepts the invitation
      const { data: invitations } = await listDiaryInvitations({
        client,
        auth: () => agentB.accessToken,
      });

      const pending = (
        invitations as unknown as { invitations: Array<{ id: string }> }
      ).invitations;
      expect(pending.length).toBeGreaterThan(0);
      const invitation = pending.find((i) => i.id === invitationId);
      expect(invitation).toBeDefined();

      await acceptDiaryInvitation({
        client,
        auth: () => agentB.accessToken,
        path: { id: invitationId },
      });

      // B now sees A's entries
      const { data, error } = await searchDiary({
        client,
        auth: () => agentB.accessToken,
        body: { includeShared: true },
      });

      expect(error).toBeUndefined();
      const results = (
        data as unknown as { results: Array<{ tags: string[] | null }> }
      ).results;
      const hasAgentA = results.some(
        (r) => r.tags && r.tags.includes('agent-a'),
      );
      expect(hasAgentA).toBe(true);
    });

    it('B always sees own entries with includeShared:true', async () => {
      const { data } = await searchDiary({
        client,
        auth: () => agentB.accessToken,
        body: { includeShared: true },
      });

      const results = (
        data as unknown as { results: Array<{ tags: string[] | null }> }
      ).results;
      const hasAgentB = results.some(
        (r) => r.tags && r.tags.includes('agent-b'),
      );
      expect(hasAgentB).toBe(true);
    });

    it('diaryId override ignores includeShared — scopes to that diary only', async () => {
      // B has access to A's diary via share, but explicit diaryId=B's own → only B's entries
      const { data } = await searchDiary({
        client,
        auth: () => agentB.accessToken,
        body: {
          diaryId: agentB.privateDiaryId,
          includeShared: true,
        },
      });

      const results = (
        data as unknown as { results: Array<{ tags: string[] | null }> }
      ).results;
      const hasAgentA = results.some(
        (r) => r.tags && r.tags.includes('agent-a'),
      );
      expect(hasAgentA).toBe(false);
    });

    it('revoked share: B can no longer see A entries', async () => {
      // A revokes B's access
      await revokeDiaryShare({
        client,
        auth: () => agentA.accessToken,
        path: {
          diaryId: agentA.privateDiaryId,
          fingerprint: agentB.keyPair.fingerprint,
        },
      });

      // B no longer sees A's entries
      const { data } = await searchDiary({
        client,
        auth: () => agentB.accessToken,
        body: { includeShared: true },
      });

      const results = (
        data as unknown as { results: Array<{ tags: string[] | null }> }
      ).results;
      const hasAgentA = results.some(
        (r) => r.tags && r.tags.includes('agent-a'),
      );
      expect(hasAgentA).toBe(false);
    });
  });

  // ── Declined share ───────────────────────────────────────────

  describe('declined share', () => {
    it('B declines A invitation: B cannot see A entries', async () => {
      // A invites B again
      await shareDiary({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.privateDiaryId },
        body: { fingerprint: agentB.keyPair.fingerprint },
      });

      // B declines
      const { data: invitations } = await listDiaryInvitations({
        client,
        auth: () => agentB.accessToken,
      });
      const pending = (
        invitations as unknown as { invitations: Array<{ id: string }> }
      ).invitations;
      const latest = pending[0];

      await declineDiaryInvitation({
        client,
        auth: () => agentB.accessToken,
        path: { id: latest.id },
      });

      const { data } = await searchDiary({
        client,
        auth: () => agentB.accessToken,
        body: { includeShared: true },
      });

      const results = (
        data as unknown as { results: Array<{ tags: string[] | null }> }
      ).results;
      const hasAgentA = results.some(
        (r) => r.tags && r.tags.includes('agent-a'),
      );
      expect(hasAgentA).toBe(false);
    });
  });

  // ── Directionality ───────────────────────────────────────────

  it('sharing is directional: A sharing to B does not give A access to B diary', async () => {
    // At this point A shared to B (even if currently revoked/declined)
    // A has no accepted share to B's diary
    const { data } = await searchDiary({
      client,
      auth: () => agentA.accessToken,
      body: { includeShared: true },
    });

    const results = (
      data as unknown as { results: Array<{ tags: string[] | null }> }
    ).results;
    const hasAgentB = results.some((r) => r.tags && r.tags.includes('agent-b'));
    expect(hasAgentB).toBe(false);
  });

  // ── Unrelated agent ──────────────────────────────────────────

  it('agentC with no shares sees only own entries', async () => {
    const { data, error } = await searchDiary({
      client,
      auth: () => agentC.accessToken,
      body: { includeShared: true },
    });

    expect(error).toBeUndefined();
    const results = (
      data as unknown as { results: Array<{ tags: string[] | null }> }
    ).results;
    const hasAgentA = results.some((r) => r.tags && r.tags.includes('agent-a'));
    const hasAgentB = results.some((r) => r.tags && r.tags.includes('agent-b'));
    expect(hasAgentA).toBe(false);
    expect(hasAgentB).toBe(false);
  });
});
