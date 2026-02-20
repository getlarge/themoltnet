/**
 * E2E: Diary Management + Sharing Lifecycle
 *
 * Tests diary CRUD, Keto permission wiring, and the full
 * invitation-based diary sharing flow between agents.
 */

import {
  acceptDiaryInvitation,
  type Client,
  createClient,
  createDiary,
  createDiaryEntry,
  declineDiaryInvitation,
  deleteDiary,
  deleteDiaryEntry,
  listDiaries,
  listDiaryEntries,
  listDiaryInvitations,
  listDiaryShares,
  revokeDiaryShare,
  shareDiary,
  updateDiary,
  updateDiaryEntry,
} from '@moltnet/api-client';
import { createDiaryRepository } from '@moltnet/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Diary Management', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent;
  let agentB: TestAgent;
  let agentC: TestAgent;

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

    const voucherC = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    agentC = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode: voucherC,
    });

    // Create default private diaries for all agents
    const diaryRepository = createDiaryRepository(harness.db);
    await diaryRepository.getOrCreateDefaultDiary(agentA.identityId, 'private');
    await diaryRepository.getOrCreateDefaultDiary(agentB.identityId, 'private');
    await diaryRepository.getOrCreateDefaultDiary(agentC.identityId, 'private');
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  /** auth shorthand */
  const authA = () => agentA.accessToken;
  const authB = () => agentB.accessToken;
  const authC = () => agentC.accessToken;

  // ── Helpers ─────────────────────────────────────────────────

  async function createTestDiary(key: string, visibility = 'private' as const) {
    const { data, error } = await createDiary({
      client,
      auth: authA,
      body: { key, visibility },
    });
    expect(error).toBeUndefined();
    return data!;
  }

  async function inviteAndAccept(
    diaryId: string,
    invitee: TestAgent,
    role: 'reader' | 'writer',
  ) {
    const inviteAuth = () => invitee.accessToken;

    const { data: shareData, error: shareError } = await shareDiary({
      client,
      auth: authA,
      path: { diaryRef: diaryId },
      body: { fingerprint: invitee.keyPair.fingerprint, role },
    });
    expect(shareError).toBeUndefined();

    const { data: acceptData, error: acceptError } =
      await acceptDiaryInvitation({
        client,
        auth: inviteAuth,
        path: { id: shareData!.id },
      });
    expect(acceptError).toBeUndefined();

    return acceptData!;
  }

  async function revokeAgent(diaryId: string, agent: TestAgent) {
    const { error } = await revokeDiaryShare({
      client,
      auth: authA,
      path: { diaryRef: diaryId, fingerprint: agent.keyPair.fingerprint },
    });
    expect(error).toBeUndefined();
  }

  // ── Diary CRUD ──────────────────────────────────────────────

  describe('Diary CRUD', () => {
    it('creates a custom diary', async () => {
      const { data, error } = await createDiary({
        client,
        auth: authA,
        body: { key: 'work-notes', name: 'Work Notes', visibility: 'private' },
      });

      expect(error).toBeUndefined();
      expect(data!.key).toBe('work-notes');
      expect(data!.name).toBe('Work Notes');
      expect(data!.visibility).toBe('private');
      expect(data!.ownerId).toBe(agentA.identityId);
      expect(data!.id).toBeDefined();
    });

    it('lists diaries for the authenticated agent', async () => {
      const { data, error } = await listDiaries({
        client,
        auth: authA,
      });

      expect(error).toBeUndefined();
      const keys = data!.items.map((d) => d.key);
      expect(keys).toContain('private');
      expect(keys).toContain('work-notes');
    });

    it('rejects duplicate diary key', async () => {
      const { error, response } = await createDiary({
        client,
        auth: authA,
        body: { key: 'work-notes' },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(400);
    });

    it('rejects invalid diary key format', async () => {
      const { error, response } = await createDiary({
        client,
        auth: authA,
        body: { key: 'INVALID KEY!' },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(400);
    });

    it('updates diary name', async () => {
      const { data: listData } = await listDiaries({ client, auth: authA });
      const diary = listData!.items.find((d) => d.key === 'work-notes');

      const { data, error } = await updateDiary({
        client,
        auth: authA,
        path: { diaryRef: diary!.id },
        body: { name: 'Work Notes Updated' },
      });

      expect(error).toBeUndefined();
      expect(data!.name).toBe('Work Notes Updated');
    });

    it('rejects deleting the default private diary', async () => {
      const { data: listData } = await listDiaries({ client, auth: authA });
      const privateDiary = listData!.items.find((d) => d.key === 'private');

      const { error, response } = await deleteDiary({
        client,
        auth: authA,
        path: { diaryRef: privateDiary!.id },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(400);
    });

    it('deletes a custom diary and cascades entries', async () => {
      const diary = await createTestDiary('temp-diary');

      await createDiaryEntry({
        client,
        auth: authA,
        path: { diaryRef: diary.id },
        body: { content: 'Entry in temp diary' },
      });

      const { error: deleteError } = await deleteDiary({
        client,
        auth: authA,
        path: { diaryRef: diary.id },
      });
      expect(deleteError).toBeUndefined();

      const { error } = await listDiaryEntries({
        client,
        auth: authA,
        path: { diaryRef: diary.id },
      });
      expect(error).toBeDefined();
    });

    it('rejects unauthenticated diary creation', async () => {
      const { error, response } = await createDiary({
        client,
        body: { key: 'no-auth' },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(401);
    });
  });

  // ── Keto Diary Permissions ──────────────────────────────────

  describe('Keto diary permissions', () => {
    let sharedDiaryId: string;

    beforeAll(async () => {
      const diary = await createTestDiary('keto-test-diary');
      sharedDiaryId = diary.id;
    });

    it('owner can create entries via Keto write permission', async () => {
      const { data, error } = await createDiaryEntry({
        client,
        auth: authA,
        path: { diaryRef: sharedDiaryId },
        body: { content: 'Entry via Keto owner write' },
      });

      expect(error).toBeUndefined();
      expect(data!.content).toBe('Entry via Keto owner write');
    });

    it('denies cross-agent diary access without share', async () => {
      const { error, response } = await listDiaryEntries({
        client,
        auth: authB,
        path: { diaryRef: sharedDiaryId },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('denies cross-agent entry creation in unshared diary', async () => {
      const { error, response } = await createDiaryEntry({
        client,
        auth: authB,
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
      const diary = await createTestDiary('share-test');
      shareDiaryId = diary.id;

      await createDiaryEntry({
        client,
        auth: authA,
        path: { diaryRef: shareDiaryId },
        body: { content: 'Shared diary entry' },
      });
    });

    it('owner invites Agent B → creates pending share', async () => {
      const { data, error, response } = await shareDiary({
        client,
        auth: authA,
        path: { diaryRef: shareDiaryId },
        body: { fingerprint: agentB.keyPair.fingerprint, role: 'writer' },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(201);
      expect(data!.status).toBe('pending');
      expect(data!.role).toBe('writer');
      expect(data!.diaryId).toBe(shareDiaryId);
      invitationId = data!.id;
    });

    it('Agent B sees pending invitation', async () => {
      const { data, error } = await listDiaryInvitations({
        client,
        auth: authB,
      });

      expect(error).toBeUndefined();
      const found = data!.invitations.find((i) => i.id === invitationId);
      expect(found).toBeDefined();
      expect(found!.diaryId).toBe(shareDiaryId);
    });

    it('Agent B accepts invitation', async () => {
      const { data, error } = await acceptDiaryInvitation({
        client,
        auth: authB,
        path: { id: invitationId },
      });

      expect(error).toBeUndefined();
      expect(data!.status).toBe('accepted');
    });

    it('Agent B can read entries in shared diary after accept', async () => {
      const { data, error } = await listDiaryEntries({
        client,
        auth: authB,
        path: { diaryRef: shareDiaryId },
      });

      expect(error).toBeUndefined();
      expect(data!.items.length).toBeGreaterThanOrEqual(1);
    });

    it('Agent B with writer role can create entries', async () => {
      const { data, error } = await createDiaryEntry({
        client,
        auth: authB,
        path: { diaryRef: shareDiaryId },
        body: { content: 'Entry by Agent B writer' },
      });

      expect(error).toBeUndefined();
      expect(data!.content).toBe('Entry by Agent B writer');
    });

    it('owner revokes share → Keto permission removed', async () => {
      const { error } = await revokeDiaryShare({
        client,
        auth: authA,
        path: {
          diaryRef: shareDiaryId,
          fingerprint: agentB.keyPair.fingerprint,
        },
      });

      expect(error).toBeUndefined();
    });

    it('Agent B cannot access diary after revocation', async () => {
      const { error, response } = await listDiaryEntries({
        client,
        auth: authB,
        path: { diaryRef: shareDiaryId },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('re-invite after revoke creates new pending share', async () => {
      const {
        data: shareData,
        error: shareError,
        response: shareRes,
      } = await shareDiary({
        client,
        auth: authA,
        path: { diaryRef: shareDiaryId },
        body: { fingerprint: agentB.keyPair.fingerprint, role: 'reader' },
      });
      expect(shareError).toBeUndefined();
      expect(shareRes.status).toBe(201);
      expect(shareData!.status).toBe('pending');

      const { error: acceptError } = await acceptDiaryInvitation({
        client,
        auth: authB,
        path: { id: shareData!.id },
      });
      expect(acceptError).toBeUndefined();

      const { data, error } = await listDiaryEntries({
        client,
        auth: authB,
        path: { diaryRef: shareDiaryId },
      });
      expect(error).toBeUndefined();
      expect(data!.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Decline Flow ────────────────────────────────────────────

  describe('Decline flow', () => {
    let declineDiaryId: string;

    beforeAll(async () => {
      const diary = await createTestDiary('decline-test');
      declineDiaryId = diary.id;

      await createDiaryEntry({
        client,
        auth: authA,
        path: { diaryRef: declineDiaryId },
        body: { content: 'Private content' },
      });
    });

    it('declining an invitation does not grant access', async () => {
      const { data: shareData } = await shareDiary({
        client,
        auth: authA,
        path: { diaryRef: declineDiaryId },
        body: { fingerprint: agentB.keyPair.fingerprint },
      });

      const { error: declineError } = await declineDiaryInvitation({
        client,
        auth: authB,
        path: { id: shareData!.id },
      });
      expect(declineError).toBeUndefined();

      const { error, response } = await listDiaryEntries({
        client,
        auth: authB,
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
      const diary = await createTestDiary('edge-test');
      edgeDiaryId = diary.id;
    });

    it('rejects self-sharing', async () => {
      const { error, response } = await shareDiary({
        client,
        auth: authA,
        path: { diaryRef: edgeDiaryId },
        body: { fingerprint: agentA.keyPair.fingerprint },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(400);
    });

    it('rejects sharing with unknown fingerprint', async () => {
      const { error, response } = await shareDiary({
        client,
        auth: authA,
        path: { diaryRef: edgeDiaryId },
        body: { fingerprint: 'AAAA-BBBB-CCCC-DDDD' },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('rejects accepting already-accepted invitation', async () => {
      const { data: shareData } = await shareDiary({
        client,
        auth: authA,
        path: { diaryRef: edgeDiaryId },
        body: { fingerprint: agentB.keyPair.fingerprint },
      });

      await acceptDiaryInvitation({
        client,
        auth: authB,
        path: { id: shareData!.id },
      });

      const { error, response } = await acceptDiaryInvitation({
        client,
        auth: authB,
        path: { id: shareData!.id },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(400);
    });

    it('rejects unauthenticated share operations', async () => {
      const { error, response } = await shareDiary({
        client,
        path: { diaryRef: edgeDiaryId },
        body: { fingerprint: agentB.keyPair.fingerprint },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(401);
    });
  });

  // ── Keto Permission Boundaries ────────────────────────────────

  describe('Keto permission boundaries', () => {
    describe('Reader role enforcement', () => {
      let readerDiaryId: string;
      let ownerEntryId: string;

      beforeAll(async () => {
        const diary = await createTestDiary('reader-role-test');
        readerDiaryId = diary.id;

        const { data: entryData } = await createDiaryEntry({
          client,
          auth: authA,
          path: { diaryRef: readerDiaryId },
          body: { content: 'Owner entry for reader test' },
        });
        ownerEntryId = entryData!.id;

        await inviteAndAccept(readerDiaryId, agentB, 'reader');
      });

      it('reader can list entries', async () => {
        const { data, error } = await listDiaryEntries({
          client,
          auth: authB,
          path: { diaryRef: readerDiaryId },
        });

        expect(error).toBeUndefined();
        expect(data!.items.length).toBeGreaterThanOrEqual(1);
      });

      it('reader CANNOT create entry', async () => {
        const { error, response } = await createDiaryEntry({
          client,
          auth: authB,
          path: { diaryRef: readerDiaryId },
          body: { content: 'Reader should not write' },
        });

        expect(error).toBeDefined();
        expect(response.status).toBe(404);
      });

      it('reader CANNOT update entry', async () => {
        const { error, response } = await updateDiaryEntry({
          client,
          auth: authB,
          path: { diaryRef: readerDiaryId, id: ownerEntryId },
          body: { content: 'Reader should not update' },
        });

        expect(error).toBeDefined();
        expect(response.status).toBe(404);
      });

      it('reader CANNOT delete entry', async () => {
        const { error, response } = await deleteDiaryEntry({
          client,
          auth: authB,
          path: { diaryRef: readerDiaryId, id: ownerEntryId },
        });

        expect(error).toBeDefined();
        expect(response.status).toBe(404);
      });
    });

    describe('Writer role enforcement', () => {
      let writerDiaryId: string;

      beforeAll(async () => {
        const diary = await createTestDiary('writer-role-test');
        writerDiaryId = diary.id;

        await inviteAndAccept(writerDiaryId, agentC, 'writer');
      });

      it('writer can list entries', async () => {
        const { error } = await listDiaryEntries({
          client,
          auth: authC,
          path: { diaryRef: writerDiaryId },
        });

        expect(error).toBeUndefined();
      });

      it('writer can create entry', async () => {
        const { data, error } = await createDiaryEntry({
          client,
          auth: authC,
          path: { diaryRef: writerDiaryId },
          body: { content: 'Writer entry in shared diary' },
        });

        expect(error).toBeUndefined();
        expect(data!.content).toBe('Writer entry in shared diary');
      });

      it('writer CANNOT update diary metadata', async () => {
        const { error, response } = await updateDiary({
          client,
          auth: authC,
          path: { diaryRef: writerDiaryId },
          body: { name: 'Writer should not manage' },
        });

        expect(error).toBeDefined();
        expect(response.status).toBe(404);
      });

      it('writer CANNOT delete diary', async () => {
        const { error, response } = await deleteDiary({
          client,
          auth: authC,
          path: { diaryRef: writerDiaryId },
        });

        expect(error).toBeDefined();
        expect(response.status).toBe(404);
      });

      it('writer CANNOT share diary with others', async () => {
        const { error, response } = await shareDiary({
          client,
          auth: authC,
          path: { diaryRef: writerDiaryId },
          body: { fingerprint: agentB.keyPair.fingerprint },
        });

        expect(error).toBeDefined();
        expect(response.status).toBe(404);
      });
    });

    describe('Role change on re-invite', () => {
      let roleDiaryId: string;

      beforeAll(async () => {
        const diary = await createTestDiary('role-change-test');
        roleDiaryId = diary.id;

        await createDiaryEntry({
          client,
          auth: authA,
          path: { diaryRef: roleDiaryId },
          body: { content: 'Entry for role change test' },
        });
      });

      it('writer downgraded to reader loses write access', async () => {
        await inviteAndAccept(roleDiaryId, agentB, 'writer');

        const { error: writeError } = await createDiaryEntry({
          client,
          auth: authB,
          path: { diaryRef: roleDiaryId },
          body: { content: 'B writes as writer' },
        });
        expect(writeError).toBeUndefined();

        await revokeAgent(roleDiaryId, agentB);
        await inviteAndAccept(roleDiaryId, agentB, 'reader');

        const { error: readError } = await listDiaryEntries({
          client,
          auth: authB,
          path: { diaryRef: roleDiaryId },
        });
        expect(readError).toBeUndefined();

        const { error: writeError2, response } = await createDiaryEntry({
          client,
          auth: authB,
          path: { diaryRef: roleDiaryId },
          body: { content: 'B tries to write as reader' },
        });
        expect(writeError2).toBeDefined();
        expect(response.status).toBe(404);
      });
    });

    describe('Owner retains access after sharing', () => {
      let ownerDiaryId: string;

      beforeAll(async () => {
        const diary = await createTestDiary('owner-retention-test');
        ownerDiaryId = diary.id;

        await inviteAndAccept(ownerDiaryId, agentB, 'writer');
        await inviteAndAccept(ownerDiaryId, agentC, 'reader');
      });

      it('owner can still create entries after sharing', async () => {
        const { data, error } = await createDiaryEntry({
          client,
          auth: authA,
          path: { diaryRef: ownerDiaryId },
          body: { content: 'Owner writes after sharing' },
        });

        expect(error).toBeUndefined();
        expect(data!.content).toBe('Owner writes after sharing');
      });

      it('owner can still update diary after sharing', async () => {
        const { data, error } = await updateDiary({
          client,
          auth: authA,
          path: { diaryRef: ownerDiaryId },
          body: { name: 'Owner Updated After Sharing' },
        });

        expect(error).toBeUndefined();
        expect(data!.name).toBe('Owner Updated After Sharing');
      });

      it('owner can still delete entries after sharing', async () => {
        const { data: entryData } = await createDiaryEntry({
          client,
          auth: authA,
          path: { diaryRef: ownerDiaryId },
          body: { content: 'Entry to delete' },
        });

        const { error } = await deleteDiaryEntry({
          client,
          auth: authA,
          path: { diaryRef: ownerDiaryId, id: entryData!.id },
        });

        expect(error).toBeUndefined();
      });
    });

    describe('Delete diary cleans Keto', () => {
      let deleteDiaryId: string;

      beforeAll(async () => {
        const diary = await createTestDiary('delete-keto-test');
        deleteDiaryId = diary.id;

        await inviteAndAccept(deleteDiaryId, agentB, 'writer');

        const { error } = await createDiaryEntry({
          client,
          auth: authB,
          path: { diaryRef: deleteDiaryId },
          body: { content: 'B entry before diary delete' },
        });
        expect(error).toBeUndefined();
      });

      it('deleting diary removes Keto grants for shared agents', async () => {
        const { error: deleteError } = await deleteDiary({
          client,
          auth: authA,
          path: { diaryRef: deleteDiaryId },
        });
        expect(deleteError).toBeUndefined();

        const { error, response } = await listDiaryEntries({
          client,
          auth: authB,
          path: { diaryRef: deleteDiaryId },
        });
        expect(error).toBeDefined();
        expect(response.status).toBe(404);
      });
    });

    describe('Non-owner cannot manage diary', () => {
      let manageDiaryId: string;

      beforeAll(async () => {
        const diary = await createTestDiary('non-owner-manage-test');
        manageDiaryId = diary.id;
      });

      it('non-owner cannot PATCH diary', async () => {
        const { error, response } = await updateDiary({
          client,
          auth: authB,
          path: { diaryRef: manageDiaryId },
          body: { name: 'Hijacked' },
        });

        expect(error).toBeDefined();
        expect(response.status).toBe(404);
      });

      it('non-owner cannot DELETE diary', async () => {
        const { error, response } = await deleteDiary({
          client,
          auth: authB,
          path: { diaryRef: manageDiaryId },
        });

        expect(error).toBeDefined();
        expect(response.status).toBe(404);
      });

      it('non-owner cannot POST share', async () => {
        const { error, response } = await shareDiary({
          client,
          auth: authB,
          path: { diaryRef: manageDiaryId },
          body: { fingerprint: agentC.keyPair.fingerprint },
        });

        expect(error).toBeDefined();
        expect(response.status).toBe(404);
      });

      it('non-owner cannot GET shares', async () => {
        const { error, response } = await listDiaryShares({
          client,
          auth: authB,
          path: { diaryRef: manageDiaryId },
        });

        expect(error).toBeDefined();
        expect(response.status).toBe(404);
      });

      it('non-owner cannot revoke share', async () => {
        const { error, response } = await revokeDiaryShare({
          client,
          auth: authB,
          path: {
            diaryRef: manageDiaryId,
            fingerprint: agentC.keyPair.fingerprint,
          },
        });

        expect(error).toBeDefined();
        expect(response.status).toBe(404);
      });
    });

    describe('Owner can list shares', () => {
      let listSharesDiaryId: string;

      beforeAll(async () => {
        const diary = await createTestDiary('list-shares-test');
        listSharesDiaryId = diary.id;

        await inviteAndAccept(listSharesDiaryId, agentB, 'writer');
        await inviteAndAccept(listSharesDiaryId, agentC, 'reader');
      });

      it('owner sees all shares with correct roles', async () => {
        const { data, error } = await listDiaryShares({
          client,
          auth: authA,
          path: { diaryRef: listSharesDiaryId },
        });

        expect(error).toBeUndefined();
        expect(data!.shares).toHaveLength(2);

        const shareB = data!.shares.find(
          (s) => s.sharedWith === agentB.identityId,
        );
        expect(shareB).toBeDefined();
        expect(shareB!.role).toBe('writer');
        expect(shareB!.status).toBe('accepted');

        const shareC = data!.shares.find(
          (s) => s.sharedWith === agentC.identityId,
        );
        expect(shareC).toBeDefined();
        expect(shareC!.role).toBe('reader');
        expect(shareC!.status).toBe('accepted');
      });

      it('writer cannot list shares', async () => {
        const { error, response } = await listDiaryShares({
          client,
          auth: authB,
          path: { diaryRef: listSharesDiaryId },
        });

        expect(error).toBeDefined();
        expect(response.status).toBe(404);
      });
    });
  });
});
