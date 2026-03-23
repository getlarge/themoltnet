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
const PACK_ID = '990e8400-e29b-41d4-a716-446655440010';
const DIARY_ID = '880e8400-e29b-41d4-a716-446655440004';

const MOCK_PACK = {
  id: PACK_ID,
  diaryId: DIARY_ID,
  packCid: 'bafyreihash',
  packCodec: 'dag-cbor',
  packType: 'compile' as const,
  params: {},
  payload: {},
  createdBy: OWNER_ID,
  creator: {
    identityId: OWNER_ID,
    fingerprint: 'C212-DAFA-27C5-6C57',
    publicKey: 'ed25519:test',
  },
  supersedesPackId: null,
  pinned: false,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  createdAt: new Date('2026-03-22T10:00:00Z'),
};

describe('PATCH /packs/:id', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    mocks.dataSource.runTransaction.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    );
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  it('pins a pack', async () => {
    mocks.contextPackRepository.findById.mockResolvedValue(MOCK_PACK);
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);
    mocks.contextPackRepository.pin.mockResolvedValue({
      ...MOCK_PACK,
      pinned: true,
      expiresAt: null,
    });
    // findById is called twice: once for lookup, once after mutation
    mocks.contextPackRepository.findById
      .mockResolvedValueOnce(MOCK_PACK)
      .mockResolvedValueOnce({
        ...MOCK_PACK,
        pinned: true,
        expiresAt: null,
      });

    const response = await app.inject({
      method: 'PATCH',
      url: `/packs/${PACK_ID}`,
      headers: authHeaders,
      payload: { pinned: true },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pinned).toBe(true);
    expect(body.expiresAt).toBeNull();
    expect(mocks.contextPackRepository.pin).toHaveBeenCalledWith(PACK_ID);
  });

  it('unpins with expiresAt', async () => {
    const pinnedPack = { ...MOCK_PACK, pinned: true, expiresAt: null };
    const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    mocks.contextPackRepository.findById
      .mockResolvedValueOnce(pinnedPack)
      .mockResolvedValueOnce({
        ...MOCK_PACK,
        pinned: false,
        expiresAt: future,
      });
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);
    mocks.contextPackRepository.unpin.mockResolvedValue({
      ...MOCK_PACK,
      pinned: false,
      expiresAt: future,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/packs/${PACK_ID}`,
      headers: authHeaders,
      payload: { pinned: false, expiresAt: future.toISOString() },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.contextPackRepository.unpin).toHaveBeenCalledWith(
      PACK_ID,
      expect.any(Date),
    );
  });

  it('rejects unpin without expiresAt', async () => {
    mocks.contextPackRepository.findById.mockResolvedValue(MOCK_PACK);
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);

    const response = await app.inject({
      method: 'PATCH',
      url: `/packs/${PACK_ID}`,
      headers: authHeaders,
      payload: { pinned: false },
    });

    expect(response.statusCode).toBe(400);
  });

  it('updates expiresAt on non-pinned pack', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    mocks.contextPackRepository.findById
      .mockResolvedValueOnce(MOCK_PACK)
      .mockResolvedValueOnce({ ...MOCK_PACK, expiresAt: future });
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);
    mocks.contextPackRepository.updateExpiry.mockResolvedValue({
      ...MOCK_PACK,
      expiresAt: future,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/packs/${PACK_ID}`,
      headers: authHeaders,
      payload: { expiresAt: future.toISOString() },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.contextPackRepository.updateExpiry).toHaveBeenCalledWith(
      PACK_ID,
      expect.any(Date),
    );
  });

  it('rejects expiresAt on pinned pack', async () => {
    const pinnedPack = { ...MOCK_PACK, pinned: true, expiresAt: null };
    mocks.contextPackRepository.findById.mockResolvedValue(pinnedPack);
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);

    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const response = await app.inject({
      method: 'PATCH',
      url: `/packs/${PACK_ID}`,
      headers: authHeaders,
      payload: { expiresAt: future.toISOString() },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects past expiresAt', async () => {
    mocks.contextPackRepository.findById.mockResolvedValue(MOCK_PACK);
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);

    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const response = await app.inject({
      method: 'PATCH',
      url: `/packs/${PACK_ID}`,
      headers: authHeaders,
      payload: { expiresAt: past.toISOString() },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects empty body', async () => {
    mocks.contextPackRepository.findById.mockResolvedValue(MOCK_PACK);
    mocks.permissionChecker.canManagePack.mockResolvedValue(true);

    const response = await app.inject({
      method: 'PATCH',
      url: `/packs/${PACK_ID}`,
      headers: authHeaders,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 403 for unauthorized agent', async () => {
    mocks.contextPackRepository.findById.mockResolvedValue(MOCK_PACK);
    mocks.permissionChecker.canManagePack.mockResolvedValue(false);

    const response = await app.inject({
      method: 'PATCH',
      url: `/packs/${PACK_ID}`,
      headers: authHeaders,
      payload: { pinned: true },
    });

    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for non-existent pack', async () => {
    mocks.contextPackRepository.findById.mockResolvedValue(null);

    const response = await app.inject({
      method: 'PATCH',
      url: `/packs/${PACK_ID}`,
      headers: authHeaders,
      payload: { pinned: true },
    });

    expect(response.statusCode).toBe(404);
  });
});
