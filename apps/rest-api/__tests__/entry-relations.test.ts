import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  DIARY_ID,
  ENTRY_ID,
  type MockServices,
  OWNER_ID,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

const RELATION_ID = 'aa0e8400-e29b-41d4-a716-446655440010';
const TARGET_ENTRY_ID = 'bb0e8400-e29b-41d4-a716-446655440011';

const MOCK_RELATION = {
  id: RELATION_ID,
  sourceId: ENTRY_ID,
  targetId: TARGET_ENTRY_ID,
  relation: 'supersedes' as const,
  status: 'proposed' as const,
  sourceCidSnapshot: null,
  targetCidSnapshot: null,
  workflowId: null,
  metadata: {},
  createdAt: new Date('2026-03-20T10:00:00Z'),
  updatedAt: new Date('2026-03-20T10:00:00Z'),
};

describe('Entry relation routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  // ── POST /entries/:entryId/relations ────────────────────────────────────

  describe('POST /entries/:entryId/relations', () => {
    it('returns 201 on successful creation', async () => {
      // Arrange
      mocks.permissionChecker.canEditEntry.mockResolvedValue(true);
      mocks.diaryEntryRepository.findByIds.mockResolvedValue([
        { id: ENTRY_ID, diaryId: DIARY_ID },
        { id: TARGET_ENTRY_ID, diaryId: DIARY_ID },
      ]);
      // createdAt is in the future relative to the route's timestampBefore — treated as new
      mocks.entryRelationRepository.create.mockResolvedValue({
        ...MOCK_RELATION,
        createdAt: new Date(Date.now() + 5000),
      });

      // Act
      const response = await app.inject({
        method: 'POST',
        url: `/entries/${ENTRY_ID}/relations`,
        headers: authHeaders,
        payload: {
          targetId: TARGET_ENTRY_ID,
          relation: 'supersedes',
        },
      });

      // Assert
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toHaveProperty('sourceId', ENTRY_ID);
      expect(body).toHaveProperty('targetId', TARGET_ENTRY_ID);
      expect(body).toHaveProperty('relation', 'supersedes');
      expect(body).toHaveProperty('status', 'proposed');
    });

    it('returns 200 on duplicate (idempotent — existing relation)', async () => {
      // Arrange
      mocks.permissionChecker.canEditEntry.mockResolvedValue(true);
      mocks.diaryEntryRepository.findByIds.mockResolvedValue([
        { id: ENTRY_ID, diaryId: DIARY_ID },
        { id: TARGET_ENTRY_ID, diaryId: DIARY_ID },
      ]);
      // createdAt far in the past — treated as pre-existing
      mocks.entryRelationRepository.create.mockResolvedValue({
        ...MOCK_RELATION,
        createdAt: new Date('2025-01-01T00:00:00Z'),
      });

      // Act
      const response = await app.inject({
        method: 'POST',
        url: `/entries/${ENTRY_ID}/relations`,
        headers: authHeaders,
        payload: {
          targetId: TARGET_ENTRY_ID,
          relation: 'supersedes',
        },
      });

      // Assert
      expect(response.statusCode).toBe(200);
    });

    it('returns 403 when canEditEntry returns false', async () => {
      // Arrange
      mocks.permissionChecker.canEditEntry.mockResolvedValue(false);

      // Act
      const response = await app.inject({
        method: 'POST',
        url: `/entries/${ENTRY_ID}/relations`,
        headers: authHeaders,
        payload: {
          targetId: TARGET_ENTRY_ID,
          relation: 'supersedes',
        },
      });

      // Assert
      expect(response.statusCode).toBe(403);
    });

    it('returns 400 when findByIds returns fewer than 2 entries', async () => {
      // Arrange
      mocks.permissionChecker.canEditEntry.mockResolvedValue(true);
      mocks.diaryEntryRepository.findByIds.mockResolvedValue([
        { id: ENTRY_ID, diaryId: DIARY_ID },
      ]);

      // Act
      const response = await app.inject({
        method: 'POST',
        url: `/entries/${ENTRY_ID}/relations`,
        headers: authHeaders,
        payload: {
          targetId: TARGET_ENTRY_ID,
          relation: 'supersedes',
        },
      });

      // Assert
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when entries belong to different diaries', async () => {
      // Arrange
      mocks.permissionChecker.canEditEntry.mockResolvedValue(true);
      mocks.diaryEntryRepository.findByIds.mockResolvedValue([
        { id: ENTRY_ID, diaryId: DIARY_ID },
        {
          id: TARGET_ENTRY_ID,
          diaryId: 'cc0e8400-e29b-41d4-a716-446655440099',
        },
      ]);

      // Act
      const response = await app.inject({
        method: 'POST',
        url: `/entries/${ENTRY_ID}/relations`,
        headers: authHeaders,
        payload: {
          targetId: TARGET_ENTRY_ID,
          relation: 'supersedes',
        },
      });

      // Assert
      expect(response.statusCode).toBe(400);
    });

    it('returns 401 when not authenticated', async () => {
      // Arrange — unauthenticated app
      const unauthApp = await createTestApp(mocks, null);

      // Act
      const response = await unauthApp.inject({
        method: 'POST',
        url: `/entries/${ENTRY_ID}/relations`,
        headers: { authorization: `Bearer ${TEST_BEARER_TOKEN}` },
        payload: {
          targetId: TARGET_ENTRY_ID,
          relation: 'supersedes',
        },
      });

      // Assert
      expect(response.statusCode).toBe(401);
    });
  });

  // ── GET /entries/:entryId/relations ─────────────────────────────────────

  describe('GET /entries/:entryId/relations', () => {
    it('returns 200 with items/total/limit/offset shape', async () => {
      // Arrange
      mocks.permissionChecker.canViewEntry.mockResolvedValue(true);
      mocks.entryRelationRepository.listByEntry.mockResolvedValue({
        items: [MOCK_RELATION],
        total: 3,
      });

      // Act
      const response = await app.inject({
        method: 'GET',
        url: `/entries/${ENTRY_ID}/relations`,
        headers: authHeaders,
      });

      // Assert
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('total', 3);
      expect(body).toHaveProperty('limit');
      expect(body).toHaveProperty('offset', 0);
      expect(body.items[0]).toHaveProperty('id', RELATION_ID);
    });

    it('returns 403 when canViewEntry returns false', async () => {
      // Arrange
      mocks.permissionChecker.canViewEntry.mockResolvedValue(false);

      // Act
      const response = await app.inject({
        method: 'GET',
        url: `/entries/${ENTRY_ID}/relations`,
        headers: authHeaders,
      });

      // Assert
      expect(response.statusCode).toBe(403);
    });

    it('passes query params to listByEntry', async () => {
      // Arrange
      mocks.permissionChecker.canViewEntry.mockResolvedValue(true);
      mocks.entryRelationRepository.listByEntry.mockResolvedValue({
        items: [],
        total: 0,
      });

      // Act
      const response = await app.inject({
        method: 'GET',
        url: `/entries/${ENTRY_ID}/relations?relation=supersedes&status=accepted&direction=as_source&limit=10&offset=5`,
        headers: authHeaders,
      });

      // Assert
      expect(response.statusCode).toBe(200);
      expect(mocks.entryRelationRepository.listByEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        {
          relation: 'supersedes',
          status: 'accepted',
          direction: 'as_source',
          limit: 10,
          offset: 5,
        },
      );
      const body = response.json();
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(5);
    });
  });

  // ── PATCH /relations/:id ─────────────────────────────────────────────────

  describe('PATCH /relations/:id', () => {
    it('returns 200 on status update', async () => {
      // Arrange
      mocks.entryRelationRepository.findById.mockResolvedValue(MOCK_RELATION);
      mocks.permissionChecker.canEditAnyEntry.mockResolvedValue(true);
      mocks.entryRelationRepository.updateStatus.mockResolvedValue({
        ...MOCK_RELATION,
        status: 'accepted' as const,
        updatedAt: new Date('2026-03-20T11:00:00Z'),
      });

      // Act
      const response = await app.inject({
        method: 'PATCH',
        url: `/relations/${RELATION_ID}`,
        headers: authHeaders,
        payload: { status: 'accepted' },
      });

      // Assert
      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('status', 'accepted');
      expect(mocks.permissionChecker.canEditAnyEntry).toHaveBeenCalledWith(
        [ENTRY_ID, TARGET_ENTRY_ID],
        OWNER_ID,
      );
    });

    it('returns 404 when findById returns null', async () => {
      // Arrange
      mocks.entryRelationRepository.findById.mockResolvedValue(null);

      // Act
      const response = await app.inject({
        method: 'PATCH',
        url: `/relations/${RELATION_ID}`,
        headers: authHeaders,
        payload: { status: 'accepted' },
      });

      // Assert
      expect(response.statusCode).toBe(404);
    });

    it('returns 403 when canEditAnyEntry returns false', async () => {
      // Arrange
      mocks.entryRelationRepository.findById.mockResolvedValue(MOCK_RELATION);
      mocks.permissionChecker.canEditAnyEntry.mockResolvedValue(false);

      // Act
      const response = await app.inject({
        method: 'PATCH',
        url: `/relations/${RELATION_ID}`,
        headers: authHeaders,
        payload: { status: 'accepted' },
      });

      // Assert
      expect(response.statusCode).toBe(403);
    });
  });

  // ── DELETE /relations/:id ────────────────────────────────────────────────

  describe('DELETE /relations/:id', () => {
    it('returns 204 on successful delete', async () => {
      // Arrange
      mocks.entryRelationRepository.findById.mockResolvedValue(MOCK_RELATION);
      mocks.permissionChecker.canEditAnyEntry.mockResolvedValue(true);
      mocks.entryRelationRepository.delete.mockResolvedValue(true);

      // Act
      const response = await app.inject({
        method: 'DELETE',
        url: `/relations/${RELATION_ID}`,
        headers: authHeaders,
      });

      // Assert
      expect(response.statusCode).toBe(204);
      expect(mocks.entryRelationRepository.delete).toHaveBeenCalledWith(
        RELATION_ID,
      );
    });

    it('returns 404 when findById returns null', async () => {
      // Arrange
      mocks.entryRelationRepository.findById.mockResolvedValue(null);

      // Act
      const response = await app.inject({
        method: 'DELETE',
        url: `/relations/${RELATION_ID}`,
        headers: authHeaders,
      });

      // Assert
      expect(response.statusCode).toBe(404);
    });

    it('returns 403 when canEditAnyEntry returns false', async () => {
      // Arrange
      mocks.entryRelationRepository.findById.mockResolvedValue(MOCK_RELATION);
      mocks.permissionChecker.canEditAnyEntry.mockResolvedValue(false);

      // Act
      const response = await app.inject({
        method: 'DELETE',
        url: `/relations/${RELATION_ID}`,
        headers: authHeaders,
      });

      // Assert
      expect(response.statusCode).toBe(403);
    });
  });
});
