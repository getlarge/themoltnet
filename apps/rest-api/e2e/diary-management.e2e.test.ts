/**
 * E2E: Diary Management + Sharing Lifecycle
 *
 * Tests diary CRUD, Keto permission wiring, and the full
 * invitation-based diary sharing flow between agents.
 */

import {
  type Client,
  createClient,
  createDiaryEntry as apiCreateDiaryEntry,
  listDiaryEntries as apiListDiaryEntries,
} from '@moltnet/api-client';
import { createDiaryRepository } from '@moltnet/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

/** Raw fetch helper for endpoints not yet in the generated API client. */
async function api(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: res.status, data };
}

describe('Diary Management', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent;
  let agentB: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    const voucherA = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    agentA = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode: voucherA,
    });

    const voucherB = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    agentB = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode: voucherB,
    });

    // Create default private diaries for both agents
    const diaryRepository = createDiaryRepository(harness.db);
    await diaryRepository.getOrCreateDefaultDiary(agentA.identityId, 'private');
    await diaryRepository.getOrCreateDefaultDiary(agentB.identityId, 'private');
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Diary CRUD ──────────────────────────────────────────────

  describe('Diary CRUD', () => {
    it('creates a custom diary', async () => {
      const { status, data } = await api(
        harness.baseUrl,
        'POST',
        '/diaries',
        agentA.accessToken,
        { key: 'work-notes', name: 'Work Notes', visibility: 'private' },
      );

      expect(status).toBe(201);
      const diary = data as Record<string, unknown>;
      expect(diary.key).toBe('work-notes');
      expect(diary.name).toBe('Work Notes');
      expect(diary.visibility).toBe('private');
      expect(diary.ownerId).toBe(agentA.identityId);
      expect(diary.id).toBeDefined();
    });

    it('lists diaries for the authenticated agent', async () => {
      const { status, data } = await api(
        harness.baseUrl,
        'GET',
        '/diaries',
        agentA.accessToken,
      );

      expect(status).toBe(200);
      const list = data as { items: Array<{ key: string }> };
      const keys = list.items.map((d) => d.key);
      expect(keys).toContain('private');
      expect(keys).toContain('work-notes');
    });

    it('rejects duplicate diary key', async () => {
      const { status } = await api(
        harness.baseUrl,
        'POST',
        '/diaries',
        agentA.accessToken,
        { key: 'work-notes' },
      );

      expect(status).toBe(400);
    });

    it('rejects invalid diary key format', async () => {
      const { status } = await api(
        harness.baseUrl,
        'POST',
        '/diaries',
        agentA.accessToken,
        { key: 'INVALID KEY!' },
      );

      expect(status).toBe(400);
    });

    it('updates diary name', async () => {
      // First, get the diary id
      const { data: listData } = await api(
        harness.baseUrl,
        'GET',
        '/diaries',
        agentA.accessToken,
      );
      const diary = (
        listData as { items: Array<{ id: string; key: string }> }
      ).items.find((d) => d.key === 'work-notes');

      const { status, data } = await api(
        harness.baseUrl,
        'PATCH',
        `/diaries/${diary!.id}`,
        agentA.accessToken,
        { name: 'Work Notes Updated' },
      );

      expect(status).toBe(200);
      expect((data as Record<string, unknown>).name).toBe('Work Notes Updated');
    });

    it('rejects deleting the default private diary', async () => {
      const { data: listData } = await api(
        harness.baseUrl,
        'GET',
        '/diaries',
        agentA.accessToken,
      );
      const privateDiary = (
        listData as { items: Array<{ id: string; key: string }> }
      ).items.find((d) => d.key === 'private');

      const { status } = await api(
        harness.baseUrl,
        'DELETE',
        `/diaries/${privateDiary!.id}`,
        agentA.accessToken,
      );

      expect(status).toBe(400);
    });

    it('deletes a custom diary and cascades entries', async () => {
      // Create a diary to delete
      const { data: createData } = await api(
        harness.baseUrl,
        'POST',
        '/diaries',
        agentA.accessToken,
        { key: 'temp-diary', visibility: 'private' },
      );
      const diaryId = (createData as Record<string, string>).id;

      // Create an entry in it
      await apiCreateDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: diaryId },
        body: { content: 'Entry in temp diary' },
      });

      // Delete the diary
      const { status } = await api(
        harness.baseUrl,
        'DELETE',
        `/diaries/${diaryId}`,
        agentA.accessToken,
      );
      expect(status).toBe(200);

      // Verify entries are gone
      const { error } = await apiListDiaryEntries({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: diaryId },
      });
      expect(error).toBeDefined();
    });

    it('rejects unauthenticated diary creation', async () => {
      const { status } = await api(
        harness.baseUrl,
        'POST',
        '/diaries',
        undefined,
        {
          key: 'no-auth',
        },
      );
      expect(status).toBe(401);
    });
  });

  // ── Keto Diary Permissions ──────────────────────────────────

  describe('Keto diary permissions', () => {
    let sharedDiaryId: string;

    beforeAll(async () => {
      const { data } = await api(
        harness.baseUrl,
        'POST',
        '/diaries',
        agentA.accessToken,
        { key: 'keto-test-diary', visibility: 'private' },
      );
      sharedDiaryId = (data as Record<string, string>).id;
    });

    it('owner can create entries via Keto write permission', async () => {
      const { data, error } = await apiCreateDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: sharedDiaryId },
        body: { content: 'Entry via Keto owner write' },
      });

      expect(error).toBeUndefined();
      expect(data!.content).toBe('Entry via Keto owner write');
    });

    it('denies cross-agent diary access without share', async () => {
      // Agent B tries to list entries in Agent A's diary by UUID
      const { error, response } = await apiListDiaryEntries({
        client,
        auth: () => agentB.accessToken,
        path: { diaryRef: sharedDiaryId },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('denies cross-agent entry creation in unshared diary', async () => {
      const { error, response } = await apiCreateDiaryEntry({
        client,
        auth: () => agentB.accessToken,
        path: { diaryRef: sharedDiaryId },
        body: { content: 'Should not be created' },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });
  });

  // ── Full Share Lifecycle ────────────────────────────────────

  describe('Diary share lifecycle', () => {
    let shareDiaryId: string;
    let invitationId: string;

    beforeAll(async () => {
      const { data } = await api(
        harness.baseUrl,
        'POST',
        '/diaries',
        agentA.accessToken,
        { key: 'share-test', visibility: 'private' },
      );
      shareDiaryId = (data as Record<string, string>).id;

      // Seed with an entry for read tests
      await apiCreateDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: shareDiaryId },
        body: { content: 'Shared diary entry' },
      });
    });

    it('owner invites Agent B → creates pending share', async () => {
      const { status, data } = await api(
        harness.baseUrl,
        'POST',
        `/diaries/${shareDiaryId}/share`,
        agentA.accessToken,
        {
          fingerprint: agentB.keyPair.fingerprint,
          role: 'writer',
        },
      );

      expect(status).toBe(201);
      const share = data as Record<string, unknown>;
      expect(share.status).toBe('pending');
      expect(share.role).toBe('writer');
      expect(share.diaryId).toBe(shareDiaryId);
      invitationId = share.id as string;
    });

    it('Agent B sees pending invitation', async () => {
      const { status, data } = await api(
        harness.baseUrl,
        'GET',
        '/diary/invitations',
        agentB.accessToken,
      );

      expect(status).toBe(200);
      const list = data as {
        invitations: Array<{ id: string; diaryId: string }>;
      };
      const found = list.invitations.find((i) => i.id === invitationId);
      expect(found).toBeDefined();
      expect(found!.diaryId).toBe(shareDiaryId);
    });

    it('Agent B accepts invitation', async () => {
      const { status, data } = await api(
        harness.baseUrl,
        'POST',
        `/diary/invitations/${invitationId}/accept`,
        agentB.accessToken,
      );

      expect(status).toBe(200);
      expect((data as Record<string, unknown>).status).toBe('accepted');
    });

    it('Agent B can read entries in shared diary after accept', async () => {
      const { data, error } = await apiListDiaryEntries({
        client,
        auth: () => agentB.accessToken,
        path: { diaryRef: shareDiaryId },
      });

      expect(error).toBeUndefined();
      const list = data as unknown as {
        items: Array<{ content: string }>;
      };
      expect(list.items.length).toBeGreaterThanOrEqual(1);
    });

    it('Agent B with writer role can create entries', async () => {
      const { data, error } = await apiCreateDiaryEntry({
        client,
        auth: () => agentB.accessToken,
        path: { diaryRef: shareDiaryId },
        body: { content: 'Entry by Agent B writer' },
      });

      expect(error).toBeUndefined();
      expect(data!.content).toBe('Entry by Agent B writer');
    });

    it('owner revokes share → Keto permission removed', async () => {
      const { status } = await api(
        harness.baseUrl,
        'DELETE',
        `/diaries/${shareDiaryId}/share/${agentB.keyPair.fingerprint}`,
        agentA.accessToken,
      );

      expect(status).toBe(200);
    });

    it('Agent B cannot access diary after revocation', async () => {
      const { error, response } = await apiListDiaryEntries({
        client,
        auth: () => agentB.accessToken,
        path: { diaryRef: shareDiaryId },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('re-invite after revoke creates new pending share', async () => {
      // Re-invite
      const { status: inviteStatus, data: inviteData } = await api(
        harness.baseUrl,
        'POST',
        `/diaries/${shareDiaryId}/share`,
        agentA.accessToken,
        { fingerprint: agentB.keyPair.fingerprint, role: 'reader' },
      );
      expect(inviteStatus).toBe(201);
      expect((inviteData as Record<string, unknown>).status).toBe('pending');

      const newInvitationId = (inviteData as Record<string, string>).id;

      // Accept
      const { status: acceptStatus } = await api(
        harness.baseUrl,
        'POST',
        `/diary/invitations/${newInvitationId}/accept`,
        agentB.accessToken,
      );
      expect(acceptStatus).toBe(200);

      // Now Agent B can read again
      const { data, error } = await apiListDiaryEntries({
        client,
        auth: () => agentB.accessToken,
        path: { diaryRef: shareDiaryId },
      });
      expect(error).toBeUndefined();
      const list = data as unknown as { items: unknown[] };
      expect(list.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Decline Flow ────────────────────────────────────────────

  describe('Decline flow', () => {
    let declineDiaryId: string;

    beforeAll(async () => {
      const { data } = await api(
        harness.baseUrl,
        'POST',
        '/diaries',
        agentA.accessToken,
        { key: 'decline-test', visibility: 'private' },
      );
      declineDiaryId = (data as Record<string, string>).id;

      await apiCreateDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: declineDiaryId },
        body: { content: 'Private content' },
      });
    });

    it('declining an invitation does not grant access', async () => {
      // Invite
      const { data: inviteData } = await api(
        harness.baseUrl,
        'POST',
        `/diaries/${declineDiaryId}/share`,
        agentA.accessToken,
        { fingerprint: agentB.keyPair.fingerprint },
      );
      const invitationId = (inviteData as Record<string, string>).id;

      // Decline
      const { status } = await api(
        harness.baseUrl,
        'POST',
        `/diary/invitations/${invitationId}/decline`,
        agentB.accessToken,
      );
      expect(status).toBe(200);

      // Try to read → 404
      const { error, response } = await apiListDiaryEntries({
        client,
        auth: () => agentB.accessToken,
        path: { diaryRef: declineDiaryId },
      });
      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────

  describe('Edge cases', () => {
    let edgeDiaryId: string;

    beforeAll(async () => {
      const { data } = await api(
        harness.baseUrl,
        'POST',
        '/diaries',
        agentA.accessToken,
        { key: 'edge-test', visibility: 'private' },
      );
      edgeDiaryId = (data as Record<string, string>).id;
    });

    it('rejects self-sharing', async () => {
      const { status } = await api(
        harness.baseUrl,
        'POST',
        `/diaries/${edgeDiaryId}/share`,
        agentA.accessToken,
        { fingerprint: agentA.keyPair.fingerprint },
      );

      expect(status).toBe(400);
    });

    it('rejects sharing with unknown fingerprint', async () => {
      const { status } = await api(
        harness.baseUrl,
        'POST',
        `/diaries/${edgeDiaryId}/share`,
        agentA.accessToken,
        { fingerprint: 'AAAA-BBBB-CCCC-DDDD' },
      );

      expect(status).toBe(404);
    });

    it('rejects accepting already-accepted invitation', async () => {
      // Invite
      const { data: inviteData } = await api(
        harness.baseUrl,
        'POST',
        `/diaries/${edgeDiaryId}/share`,
        agentA.accessToken,
        { fingerprint: agentB.keyPair.fingerprint },
      );
      const invitationId = (inviteData as Record<string, string>).id;

      // Accept first time
      await api(
        harness.baseUrl,
        'POST',
        `/diary/invitations/${invitationId}/accept`,
        agentB.accessToken,
      );

      // Accept again → 400
      const { status } = await api(
        harness.baseUrl,
        'POST',
        `/diary/invitations/${invitationId}/accept`,
        agentB.accessToken,
      );
      expect(status).toBe(400);
    });

    it('rejects unauthenticated share operations', async () => {
      const { status } = await api(
        harness.baseUrl,
        'POST',
        `/diaries/${edgeDiaryId}/share`,
        undefined,
        { fingerprint: agentB.keyPair.fingerprint },
      );
      expect(status).toBe(401);
    });
  });
});
