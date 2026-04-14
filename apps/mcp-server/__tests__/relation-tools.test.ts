import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleRelationsCreate,
  handleRelationsDelete,
  handleRelationsList,
  handleRelationsUpdate,
} from '../src/relation-tools.js';
import type { HandlerContext, McpDeps } from '../src/types.js';
import {
  createMockContext,
  createMockDeps,
  ENTRY_ID,
  getTextContent,
  parseResult,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  createEntryRelation: vi.fn(),
  listEntryRelations: vi.fn(),
  updateEntryRelationStatus: vi.fn(),
  deleteEntryRelation: vi.fn(),
}));

import {
  createEntryRelation,
  deleteEntryRelation,
  listEntryRelations,
  updateEntryRelationStatus,
} from '@moltnet/api-client';

const RELATION_ID = '990e8400-e29b-41d4-a716-446655440003';
const TARGET_ID = '880e8400-e29b-41d4-a716-446655440004';

describe('Relation tools', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  describe('relations_create', () => {
    it('creates a relation and returns relation data', async () => {
      const relation = {
        id: RELATION_ID,
        sourceId: ENTRY_ID,
        targetId: TARGET_ID,
        relation: 'supports',
        status: 'proposed',
      };
      vi.mocked(createEntryRelation).mockResolvedValue(
        sdkOk(relation, 201) as never,
      );

      const result = await handleRelationsCreate(
        { entry_id: ENTRY_ID, target_id: TARGET_ID, relation: 'supports' },
        deps,
        context,
      );

      expect(createEntryRelation).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { entryId: ENTRY_ID },
          body: { targetId: TARGET_ID, relation: 'supports' },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toMatchObject({
        id: RELATION_ID,
        sourceId: ENTRY_ID,
        targetId: TARGET_ID,
        relation: 'supports',
      });
      expect(result.structuredContent).toEqual(relation);
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleRelationsCreate(
        { entry_id: ENTRY_ID, target_id: TARGET_ID, relation: 'supports' },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });

    it('forwards API error message', async () => {
      vi.mocked(createEntryRelation).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleRelationsCreate(
        { entry_id: 'nonexistent', target_id: TARGET_ID, relation: 'supports' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });
  });

  describe('relations_list', () => {
    it('returns list of relations for an entry', async () => {
      const data = {
        items: [
          {
            id: RELATION_ID,
            sourceId: ENTRY_ID,
            targetId: TARGET_ID,
            relation: 'supports',
            status: 'proposed',
          },
        ],
        total: 1,
      };
      vi.mocked(listEntryRelations).mockResolvedValue(sdkOk(data) as never);

      const result = await handleRelationsList(
        { entry_id: ENTRY_ID },
        deps,
        context,
      );

      expect(listEntryRelations).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { entryId: ENTRY_ID },
          query: {},
        }),
      );
      const parsed = parseResult<{ items: unknown[] }>(result);
      expect(parsed.items).toHaveLength(1);
      expect(result.structuredContent).toEqual(data);
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleRelationsList(
        { entry_id: ENTRY_ID },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });

    it('returns error when API fails', async () => {
      vi.mocked(listEntryRelations).mockResolvedValue(
        sdkErr({
          error: 'Internal Server Error',
          message: 'Server error',
          statusCode: 500,
        }) as never,
      );

      const result = await handleRelationsList(
        { entry_id: ENTRY_ID },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Server error');
    });
  });

  describe('relations_update', () => {
    it('updates a relation status and returns updated relation', async () => {
      const updated = {
        id: RELATION_ID,
        sourceId: ENTRY_ID,
        targetId: TARGET_ID,
        relation: 'supports',
        status: 'accepted',
      };
      vi.mocked(updateEntryRelationStatus).mockResolvedValue(
        sdkOk(updated) as never,
      );

      const result = await handleRelationsUpdate(
        { relation_id: RELATION_ID, status: 'accepted' },
        deps,
        context,
      );

      expect(updateEntryRelationStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: RELATION_ID },
          body: { status: 'accepted' },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toMatchObject({
        id: RELATION_ID,
        status: 'accepted',
      });
      expect(result.structuredContent).toEqual(updated);
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleRelationsUpdate(
        { relation_id: RELATION_ID, status: 'accepted' },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });

    it('returns error when relation not found', async () => {
      vi.mocked(updateEntryRelationStatus).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Relation not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleRelationsUpdate(
        { relation_id: 'nonexistent', status: 'accepted' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });
  });

  describe('relations_delete', () => {
    it('deletes a relation and returns deleted confirmation', async () => {
      vi.mocked(deleteEntryRelation).mockResolvedValue(
        sdkOk(undefined, 204) as never,
      );

      const result = await handleRelationsDelete(
        { relation_id: RELATION_ID },
        deps,
        context,
      );

      expect(deleteEntryRelation).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: RELATION_ID },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('success', true);
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleRelationsDelete(
        { relation_id: RELATION_ID },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });

    it('returns error when relation not found', async () => {
      vi.mocked(deleteEntryRelation).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Relation not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleRelationsDelete(
        { relation_id: 'nonexistent' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });
  });
});
