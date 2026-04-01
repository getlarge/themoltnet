import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRelationshipWriter,
  type RelationshipWriter,
} from '../src/relationship-writer.js';

interface MockRelationshipApi {
  createRelationship: ReturnType<typeof vi.fn>;
  deleteRelationships: ReturnType<typeof vi.fn>;
  patchRelationships: ReturnType<typeof vi.fn>;
}

function createMockRelationshipApi(): MockRelationshipApi {
  return {
    createRelationship: vi.fn(),
    deleteRelationships: vi.fn(),
    patchRelationships: vi.fn(),
  };
}

const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const DIARY_ID = '880e8400-e29b-41d4-a716-446655440004';
const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';

describe('RelationshipWriter', () => {
  let mockRelationshipApi: MockRelationshipApi;
  let writer: RelationshipWriter;

  beforeEach(() => {
    mockRelationshipApi = createMockRelationshipApi();
    writer = createRelationshipWriter(mockRelationshipApi as any);
  });

  describe('diary relationships', () => {
    it('grants diary team relation', async () => {
      mockRelationshipApi.createRelationship.mockResolvedValue({});

      const TEAM_ID = '00000000-0000-4000-b000-000000000001';
      await writer.grantDiaryTeam(DIARY_ID, TEAM_ID);

      expect(mockRelationshipApi.createRelationship).toHaveBeenCalledWith({
        createRelationshipBody: {
          namespace: 'Diary',
          object: DIARY_ID,
          relation: 'team',
          subject_set: {
            namespace: 'Team',
            object: TEAM_ID,
            relation: '',
          },
        },
      });
    });

    it('removes all diary relations', async () => {
      mockRelationshipApi.deleteRelationships.mockResolvedValue({});

      await writer.removeDiaryRelations(DIARY_ID);

      expect(mockRelationshipApi.deleteRelationships).toHaveBeenCalledWith({
        namespace: 'Diary',
        object: DIARY_ID,
      });
    });

    it('removes diary team relation', async () => {
      mockRelationshipApi.deleteRelationships.mockResolvedValue({});

      await writer.removeDiaryTeam(DIARY_ID);

      expect(mockRelationshipApi.deleteRelationships).toHaveBeenCalledWith({
        namespace: 'Diary',
        object: DIARY_ID,
        relation: 'team',
      });
    });
  });

  describe('grantEntryParent', () => {
    it('creates parent relation tuple using subject_set', async () => {
      mockRelationshipApi.createRelationship.mockResolvedValue({});

      await writer.grantEntryParent(ENTRY_ID, DIARY_ID);

      expect(mockRelationshipApi.createRelationship).toHaveBeenCalledWith({
        createRelationshipBody: {
          namespace: 'DiaryEntry',
          object: ENTRY_ID,
          relation: 'parent',
          subject_set: {
            namespace: 'Diary',
            object: DIARY_ID,
            relation: '',
          },
        },
      });
    });

    it('throws on API error', async () => {
      mockRelationshipApi.createRelationship.mockRejectedValue(
        new Error('Keto unavailable'),
      );

      await expect(writer.grantEntryParent(ENTRY_ID, DIARY_ID)).rejects.toThrow(
        'Keto unavailable',
      );
    });
  });

  describe('registerAgent', () => {
    it('creates agent self relation', async () => {
      mockRelationshipApi.createRelationship.mockResolvedValue({});

      await writer.registerAgent(AGENT_ID);

      expect(mockRelationshipApi.createRelationship).toHaveBeenCalledWith({
        createRelationshipBody: {
          namespace: 'Agent',
          object: AGENT_ID,
          relation: 'self',
          subject_id: AGENT_ID,
        },
      });
    });
  });

  describe('removeEntryRelations', () => {
    it('deletes all relations for an entry', async () => {
      mockRelationshipApi.deleteRelationships.mockResolvedValue({});

      await writer.removeEntryRelations(ENTRY_ID);

      expect(mockRelationshipApi.deleteRelationships).toHaveBeenCalledWith({
        namespace: 'DiaryEntry',
        object: ENTRY_ID,
      });
    });
  });

  describe('removePackRelationsBatch', () => {
    const PACK_ID_1 = 'aaaa0000-0000-0000-0000-000000000001';
    const PACK_ID_2 = 'aaaa0000-0000-0000-0000-000000000002';
    const DIARY_ID_1 = 'bbbb0000-0000-0000-0000-000000000001';
    const DIARY_ID_2 = 'bbbb0000-0000-0000-0000-000000000002';

    it('sends single patchRelationships call with delete actions', async () => {
      mockRelationshipApi.patchRelationships.mockResolvedValue(undefined);

      await writer.removePackRelationsBatch([
        { id: PACK_ID_1, diaryId: DIARY_ID_1 },
        { id: PACK_ID_2, diaryId: DIARY_ID_2 },
      ]);

      expect(mockRelationshipApi.patchRelationships).toHaveBeenCalledOnce();
      expect(mockRelationshipApi.patchRelationships).toHaveBeenCalledWith({
        relationshipPatch: [
          {
            action: 'delete',
            relation_tuple: {
              namespace: 'ContextPack',
              object: PACK_ID_1,
              relation: 'parent',
              subject_set: {
                namespace: 'Diary',
                object: DIARY_ID_1,
                relation: '',
              },
            },
          },
          {
            action: 'delete',
            relation_tuple: {
              namespace: 'ContextPack',
              object: PACK_ID_2,
              relation: 'parent',
              subject_set: {
                namespace: 'Diary',
                object: DIARY_ID_2,
                relation: '',
              },
            },
          },
        ],
      });
    });

    it('is a no-op for empty array', async () => {
      await writer.removePackRelationsBatch([]);

      expect(mockRelationshipApi.patchRelationships).not.toHaveBeenCalled();
    });
  });
});
