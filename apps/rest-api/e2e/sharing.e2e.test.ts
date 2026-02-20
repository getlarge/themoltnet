/**
 * E2E: Diary sharing between agents
 *
 * Tests sharing, shared-with-me listing, and authz checks with scoped diary refs.
 */

import {
  type Client,
  createClient,
  createDiaryEntry as apiCreateDiaryEntry,
  getSharedWithMe,
  shareDiaryEntry as apiShareDiaryEntry,
} from '@moltnet/api-client';
import { createDiaryRepository } from '@moltnet/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Diary Sharing', () => {
  const PRIVATE_DIARY_REF = 'private';

  function createDiaryEntry(
    args: Parameters<typeof apiCreateDiaryEntry>[0] & {
      path?: { diaryRef?: string };
    },
  ) {
    return apiCreateDiaryEntry({
      ...args,
      path: { diaryRef: args.path?.diaryRef ?? PRIVATE_DIARY_REF },
    });
  }

  function shareDiaryEntry(
    args: Parameters<typeof apiShareDiaryEntry>[0] & {
      path: { id: string; diaryRef?: string };
    },
  ) {
    return apiShareDiaryEntry({
      ...args,
      path: {
        diaryRef: args.path.diaryRef ?? PRIVATE_DIARY_REF,
        id: args.path.id,
      },
    });
  }

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

    const diaryRepository = createDiaryRepository(harness.db);
    await diaryRepository.getOrCreateDefaultDiary(agentA.identityId, 'private');
    await diaryRepository.getOrCreateDefaultDiary(agentB.identityId, 'private');
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  describe('POST /diaries/:diaryRef/entries/:id/share', () => {
    it('shares an entry with another agent by fingerprint', async () => {
      const { data: entry } = await createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: PRIVATE_DIARY_REF },
        body: { content: 'Shared knowledge from Agent A', title: 'Shared' },
      });

      const { data, error } = await shareDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: PRIVATE_DIARY_REF, id: entry!.id },
        body: { sharedWith: agentB.keyPair.fingerprint },
      });

      expect(error).toBeUndefined();
      expect(data!.success).toBe(true);
      expect(data!.sharedWith).toBe(agentB.keyPair.fingerprint);
    });

    it('returns 404 for non-existent target fingerprint', async () => {
      const { data: entry } = await createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: PRIVATE_DIARY_REF },
        body: { content: 'Share target missing' },
      });

      const { data, error, response } = await shareDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: PRIVATE_DIARY_REF, id: entry!.id },
        body: { sharedWith: 'AAAA-BBBB-CCCC-DDDD' },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('returns 404 when sharing entry you do not own', async () => {
      const { data: entry } = await createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: PRIVATE_DIARY_REF },
        body: { content: 'Only A owns this' },
      });

      const { data, error, response } = await shareDiaryEntry({
        client,
        auth: () => agentB.accessToken,
        path: { diaryRef: PRIVATE_DIARY_REF, id: entry!.id },
        body: { sharedWith: agentA.keyPair.fingerprint },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('returns 404 when diary ref does not match entry diary', async () => {
      const diaryRepository = createDiaryRepository(harness.db);
      await diaryRepository.create({
        ownerId: agentA.identityId,
        key: 'work',
        name: 'Work',
        visibility: 'private',
      });

      const { data: entry } = await createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: PRIVATE_DIARY_REF },
        body: { content: 'Wrong diary ref share test' },
      });

      const { data, error, response } = await shareDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: 'work', id: entry!.id },
        body: { sharedWith: agentB.keyPair.fingerprint },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('rejects unauthenticated request', async () => {
      const { data, error, response } = await shareDiaryEntry({
        client,
        path: {
          diaryRef: PRIVATE_DIARY_REF,
          id: '00000000-0000-0000-0000-000000000000',
        },
        body: { sharedWith: agentB.keyPair.fingerprint },
      });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(401);
    });
  });

  describe('GET /diary/shared-with-me', () => {
    it('lists entries shared with the authenticated agent', async () => {
      const { data: entry } = await createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: PRIVATE_DIARY_REF },
        body: {
          content: 'Shared for listing test',
          title: 'SharedWithMeTest',
        },
      });

      await shareDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryRef: PRIVATE_DIARY_REF, id: entry!.id },
        body: { sharedWith: agentB.keyPair.fingerprint },
      });

      const { data, error } = await getSharedWithMe({
        client,
        auth: () => agentB.accessToken,
      });

      expect(error).toBeUndefined();
      expect(data!.entries).toBeDefined();
      expect(data!.entries.length).toBeGreaterThanOrEqual(1);

      const shared = data!.entries.find(
        (e: { content: string }) => e.content === 'Shared for listing test',
      );
      expect(shared).toBeDefined();
    });

    it('returns empty list when nothing is shared', async () => {
      const voucherC = await createTestVoucher({
        db: harness.db,
        issuerId: harness.bootstrapIdentityId,
      });
      const agentC = await createAgent({
        baseUrl: harness.baseUrl,
        identityApi: harness.identityApi,
        hydraAdminOAuth2: harness.hydraAdminOAuth2,
        webhookApiKey: harness.webhookApiKey,
        voucherCode: voucherC,
      });

      const diaryRepository = createDiaryRepository(harness.db);
      await diaryRepository.getOrCreateDefaultDiary(
        agentC.identityId,
        'private',
      );

      const { data, error } = await getSharedWithMe({
        client,
        auth: () => agentC.accessToken,
      });

      expect(error).toBeUndefined();
      expect(data!.entries).toEqual([]);
    });

    it('rejects unauthenticated request', async () => {
      const { data, error, response } = await getSharedWithMe({ client });

      expect(data).toBeUndefined();
      expect(error).toBeDefined();
      expect(response.status).toBe(401);
    });
  });
});
