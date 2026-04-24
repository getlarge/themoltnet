import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
  OWNER_ID,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
const RENDERED_PACK_ID = '990e8400-e29b-41d4-a716-446655440020';
const SOURCE_PACK_ID = '990e8400-e29b-41d4-a716-446655440010';
const DIARY_ID = '880e8400-e29b-41d4-a716-446655440004';
const TASK_ID = '770e8400-e29b-41d4-a716-446655440099';

const MOCK_RENDERED_PACK = {
  id: RENDERED_PACK_ID,
  packCid: 'bafyreihash',
  sourcePackId: SOURCE_PACK_ID,
  diaryId: DIARY_ID,
  content: '# Rendered Pack\n',
  contentHash: 'abc123',
  renderMethod: 'agent-refined',
  totalTokens: 100,
  createdBy: OWNER_ID,
  pinned: false,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  createdAt: new Date('2026-03-22T10:00:00Z'),
};

describe('PATCH /rendered-packs/:id', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    mocks.dataSource.runTransaction.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    );
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  it('pins a rendered pack', async () => {
    mocks.renderedPackRepository.findById.mockResolvedValueOnce(
      MOCK_RENDERED_PACK,
    );
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);
    mocks.renderedPackRepository.pin.mockResolvedValue({
      ...MOCK_RENDERED_PACK,
      pinned: true,
      expiresAt: null,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/rendered-packs/${RENDERED_PACK_ID}`,
      headers: authHeaders,
      payload: { pinned: true },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pinned).toBe(true);
    expect(mocks.renderedPackRepository.pin).toHaveBeenCalledWith(
      RENDERED_PACK_ID,
    );
    expect(mocks.permissionChecker.canManagePack).toHaveBeenCalledWith(
      SOURCE_PACK_ID,
      OWNER_ID,
      expect.any(String),
    );
  });

  it('unpins with expiresAt', async () => {
    const pinnedPack = {
      ...MOCK_RENDERED_PACK,
      pinned: true,
      expiresAt: null,
    };
    const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    mocks.renderedPackRepository.findById.mockResolvedValueOnce(pinnedPack);
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);
    mocks.renderedPackRepository.unpin.mockResolvedValue({
      ...MOCK_RENDERED_PACK,
      pinned: false,
      expiresAt: future,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/rendered-packs/${RENDERED_PACK_ID}`,
      headers: authHeaders,
      payload: { pinned: false, expiresAt: future.toISOString() },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.renderedPackRepository.unpin).toHaveBeenCalledWith(
      RENDERED_PACK_ID,
      expect.any(Date),
    );
  });

  it('rejects unpin without expiresAt', async () => {
    mocks.renderedPackRepository.findById.mockResolvedValue(MOCK_RENDERED_PACK);
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);

    const response = await app.inject({
      method: 'PATCH',
      url: `/rendered-packs/${RENDERED_PACK_ID}`,
      headers: authHeaders,
      payload: { pinned: false },
    });

    expect(response.statusCode).toBe(400);
  });

  it('updates expiresAt on non-pinned pack', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    mocks.renderedPackRepository.findById.mockResolvedValueOnce(
      MOCK_RENDERED_PACK,
    );
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);
    mocks.renderedPackRepository.updateExpiry.mockResolvedValue({
      ...MOCK_RENDERED_PACK,
      expiresAt: future,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/rendered-packs/${RENDERED_PACK_ID}`,
      headers: authHeaders,
      payload: { expiresAt: future.toISOString() },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.renderedPackRepository.updateExpiry).toHaveBeenCalledWith(
      RENDERED_PACK_ID,
      expect.any(Date),
    );
  });

  it('rejects expiresAt on pinned pack', async () => {
    const pinnedPack = {
      ...MOCK_RENDERED_PACK,
      pinned: true,
      expiresAt: null,
    };
    mocks.renderedPackRepository.findById.mockResolvedValue(pinnedPack);
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);

    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const response = await app.inject({
      method: 'PATCH',
      url: `/rendered-packs/${RENDERED_PACK_ID}`,
      headers: authHeaders,
      payload: { expiresAt: future.toISOString() },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects past expiresAt', async () => {
    mocks.renderedPackRepository.findById.mockResolvedValue(MOCK_RENDERED_PACK);
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);

    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const response = await app.inject({
      method: 'PATCH',
      url: `/rendered-packs/${RENDERED_PACK_ID}`,
      headers: authHeaders,
      payload: { expiresAt: past.toISOString() },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects empty body', async () => {
    mocks.renderedPackRepository.findById.mockResolvedValue(MOCK_RENDERED_PACK);
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);

    const response = await app.inject({
      method: 'PATCH',
      url: `/rendered-packs/${RENDERED_PACK_ID}`,
      headers: authHeaders,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects body containing only unknown properties', async () => {
    mocks.renderedPackRepository.findById.mockResolvedValue(MOCK_RENDERED_PACK);
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);

    const response = await app.inject({
      method: 'PATCH',
      url: `/rendered-packs/${RENDERED_PACK_ID}`,
      headers: authHeaders,
      payload: { foo: 'bar' },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.renderedPackRepository.pin).not.toHaveBeenCalled();
    expect(mocks.renderedPackRepository.unpin).not.toHaveBeenCalled();
    expect(mocks.renderedPackRepository.updateExpiry).not.toHaveBeenCalled();
  });

  it('returns 409 when concurrent pin turns updateExpiry into a no-op', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    mocks.renderedPackRepository.findById.mockResolvedValueOnce(
      MOCK_RENDERED_PACK,
    );
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);
    mocks.renderedPackRepository.updateExpiry.mockResolvedValue(null);

    const response = await app.inject({
      method: 'PATCH',
      url: `/rendered-packs/${RENDERED_PACK_ID}`,
      headers: authHeaders,
      payload: { expiresAt: future.toISOString() },
    });

    expect(response.statusCode).toBe(409);
    expect(mocks.renderedPackRepository.updateExpiry).toHaveBeenCalledWith(
      RENDERED_PACK_ID,
      expect.any(Date),
    );
  });

  it('returns 403 for unauthorized agent', async () => {
    mocks.renderedPackRepository.findById.mockResolvedValue(MOCK_RENDERED_PACK);
    mocks.permissionChecker.canManagePack.mockResolvedValue(false);

    const response = await app.inject({
      method: 'PATCH',
      url: `/rendered-packs/${RENDERED_PACK_ID}`,
      headers: authHeaders,
      payload: { pinned: true },
    });

    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for non-existent rendered pack', async () => {
    mocks.renderedPackRepository.findById.mockResolvedValue(null);

    const response = await app.inject({
      method: 'PATCH',
      url: `/rendered-packs/${RENDERED_PACK_ID}`,
      headers: authHeaders,
      payload: { pinned: true },
    });

    expect(response.statusCode).toBe(404);
  });

  describe('verifiedTaskId', () => {
    const MOCK_JUDGE_TASK = {
      id: TASK_ID,
      taskType: 'judge_pack',
      diaryId: DIARY_ID,
      teamId: 'team-1',
      status: 'completed',
      input: { renderedPackId: RENDERED_PACK_ID, sourcePackId: SOURCE_PACK_ID },
    };
    const COMPLETED_ATTEMPT = { status: 'completed', attemptN: 1 };

    it('sets verifiedTaskId on happy path', async () => {
      const verified = { ...MOCK_RENDERED_PACK, verifiedTaskId: TASK_ID };
      mocks.renderedPackRepository.findById.mockResolvedValueOnce(
        MOCK_RENDERED_PACK,
      );
      mocks.permissionChecker.canManagePack.mockResolvedValue(true);
      mocks.taskRepository.findById.mockResolvedValueOnce(MOCK_JUDGE_TASK);
      mocks.taskRepository.listAttempts.mockResolvedValueOnce([
        COMPLETED_ATTEMPT,
      ]);
      mocks.renderedPackRepository.setVerifiedTask.mockResolvedValueOnce(
        verified,
      );

      const response = await app.inject({
        method: 'PATCH',
        url: `/rendered-packs/${RENDERED_PACK_ID}`,
        headers: authHeaders,
        payload: { verifiedTaskId: TASK_ID },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().verifiedTaskId).toBe(TASK_ID);
      expect(mocks.renderedPackRepository.setVerifiedTask).toHaveBeenCalledWith(
        RENDERED_PACK_ID,
        TASK_ID,
      );
    });

    it('rejects when task not found', async () => {
      mocks.renderedPackRepository.findById.mockResolvedValueOnce(
        MOCK_RENDERED_PACK,
      );
      mocks.permissionChecker.canManagePack.mockResolvedValue(true);
      mocks.taskRepository.findById.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'PATCH',
        url: `/rendered-packs/${RENDERED_PACK_ID}`,
        headers: authHeaders,
        payload: { verifiedTaskId: TASK_ID },
      });

      expect(response.statusCode).toBe(404);
    });

    it('rejects wrong taskType', async () => {
      mocks.renderedPackRepository.findById.mockResolvedValueOnce(
        MOCK_RENDERED_PACK,
      );
      mocks.permissionChecker.canManagePack.mockResolvedValue(true);
      mocks.taskRepository.findById.mockResolvedValueOnce({
        ...MOCK_JUDGE_TASK,
        taskType: 'curate_pack',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/rendered-packs/${RENDERED_PACK_ID}`,
        headers: authHeaders,
        payload: { verifiedTaskId: TASK_ID },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects task from a different diary', async () => {
      mocks.renderedPackRepository.findById.mockResolvedValueOnce(
        MOCK_RENDERED_PACK,
      );
      mocks.permissionChecker.canManagePack.mockResolvedValue(true);
      mocks.taskRepository.findById.mockResolvedValueOnce({
        ...MOCK_JUDGE_TASK,
        diaryId: '00000000-0000-0000-0000-000000000099',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/rendered-packs/${RENDERED_PACK_ID}`,
        headers: authHeaders,
        payload: { verifiedTaskId: TASK_ID },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects mismatched renderedPackId in task input', async () => {
      mocks.renderedPackRepository.findById.mockResolvedValueOnce(
        MOCK_RENDERED_PACK,
      );
      mocks.permissionChecker.canManagePack.mockResolvedValue(true);
      mocks.taskRepository.findById.mockResolvedValueOnce({
        ...MOCK_JUDGE_TASK,
        input: {
          renderedPackId: '00000000-0000-0000-0000-000000000088',
          sourcePackId: SOURCE_PACK_ID,
        },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/rendered-packs/${RENDERED_PACK_ID}`,
        headers: authHeaders,
        payload: { verifiedTaskId: TASK_ID },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects task with no completed attempt', async () => {
      mocks.renderedPackRepository.findById.mockResolvedValueOnce(
        MOCK_RENDERED_PACK,
      );
      mocks.permissionChecker.canManagePack.mockResolvedValue(true);
      mocks.taskRepository.findById.mockResolvedValueOnce(MOCK_JUDGE_TASK);
      mocks.taskRepository.listAttempts.mockResolvedValueOnce([
        { status: 'failed', attemptN: 1 },
      ]);

      const response = await app.inject({
        method: 'PATCH',
        url: `/rendered-packs/${RENDERED_PACK_ID}`,
        headers: authHeaders,
        payload: { verifiedTaskId: TASK_ID },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when setVerifiedTask returns null (concurrent delete)', async () => {
      mocks.renderedPackRepository.findById.mockResolvedValueOnce(
        MOCK_RENDERED_PACK,
      );
      mocks.permissionChecker.canManagePack.mockResolvedValue(true);
      mocks.taskRepository.findById.mockResolvedValueOnce(MOCK_JUDGE_TASK);
      mocks.taskRepository.listAttempts.mockResolvedValueOnce([
        COMPLETED_ATTEMPT,
      ]);
      mocks.renderedPackRepository.setVerifiedTask.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'PATCH',
        url: `/rendered-packs/${RENDERED_PACK_ID}`,
        headers: authHeaders,
        payload: { verifiedTaskId: TASK_ID },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
