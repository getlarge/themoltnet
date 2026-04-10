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
    mocks.renderedPackRepository.findById
      .mockResolvedValueOnce(MOCK_RENDERED_PACK)
      .mockResolvedValueOnce({
        ...MOCK_RENDERED_PACK,
        pinned: true,
        expiresAt: null,
      });
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
    mocks.renderedPackRepository.findById
      .mockResolvedValueOnce(pinnedPack)
      .mockResolvedValueOnce({
        ...MOCK_RENDERED_PACK,
        pinned: false,
        expiresAt: future,
      });
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
    mocks.renderedPackRepository.findById
      .mockResolvedValueOnce(MOCK_RENDERED_PACK)
      .mockResolvedValueOnce({ ...MOCK_RENDERED_PACK, expiresAt: future });
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
});
