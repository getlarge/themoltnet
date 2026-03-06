import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRelationshipReader,
  type RelationshipReader,
} from '../src/relationship-reader.js';

interface MockRelationshipApi {
  getRelationships: ReturnType<typeof vi.fn>;
}

function createMockRelationshipApi(): MockRelationshipApi {
  return {
    getRelationships: vi.fn(),
  };
}

const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const DIARY_ID_1 = '880e8400-e29b-41d4-a716-446655440001';
const DIARY_ID_2 = '880e8400-e29b-41d4-a716-446655440002';

describe('RelationshipReader', () => {
  let mockRelationshipApi: MockRelationshipApi;
  let reader: RelationshipReader;

  beforeEach(() => {
    mockRelationshipApi = createMockRelationshipApi();
    reader = createRelationshipReader(mockRelationshipApi as any);
  });

  describe('listDiaryIdsByAgent', () => {
    it('queries Keto for all Diary relations for the agent', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({
        relation_tuples: [],
      });

      await reader.listDiaryIdsByAgent(AGENT_ID);

      expect(mockRelationshipApi.getRelationships).toHaveBeenCalledWith({
        namespace: 'Diary',
        subjectId: AGENT_ID,
        pageToken: undefined,
      });
    });

    it('follows pagination tokens until exhausted', async () => {
      const DIARY_ID_3 = '880e8400-e29b-41d4-a716-446655440003';
      mockRelationshipApi.getRelationships
        .mockResolvedValueOnce({
          relation_tuples: [
            { object: DIARY_ID_1, relation: 'owner', subject_id: AGENT_ID },
          ],
          next_page_token: 'token-page-2',
        })
        .mockResolvedValueOnce({
          relation_tuples: [
            { object: DIARY_ID_2, relation: 'writers', subject_id: AGENT_ID },
            { object: DIARY_ID_3, relation: 'readers', subject_id: AGENT_ID },
          ],
          next_page_token: '',
        });

      const ids = await reader.listDiaryIdsByAgent(AGENT_ID);

      expect(mockRelationshipApi.getRelationships).toHaveBeenCalledTimes(2);
      expect(mockRelationshipApi.getRelationships).toHaveBeenNthCalledWith(2, {
        namespace: 'Diary',
        subjectId: AGENT_ID,
        pageToken: 'token-page-2',
      });
      expect(ids).toEqual(
        expect.arrayContaining([DIARY_ID_1, DIARY_ID_2, DIARY_ID_3]),
      );
      expect(ids).toHaveLength(3);
    });

    it('returns diary IDs across all relations', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({
        relation_tuples: [
          { object: DIARY_ID_1, relation: 'owner', subject_id: AGENT_ID },
          { object: DIARY_ID_2, relation: 'writers', subject_id: AGENT_ID },
        ],
      });

      const ids = await reader.listDiaryIdsByAgent(AGENT_ID);

      expect(ids).toEqual([DIARY_ID_1, DIARY_ID_2]);
    });

    it('deduplicates diary IDs when agent has multiple relations on same diary', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({
        relation_tuples: [
          { object: DIARY_ID_1, relation: 'owner', subject_id: AGENT_ID },
          { object: DIARY_ID_1, relation: 'writers', subject_id: AGENT_ID },
        ],
      });

      const ids = await reader.listDiaryIdsByAgent(AGENT_ID);

      expect(ids).toEqual([DIARY_ID_1]);
    });

    it('returns empty array when no relation tuples exist', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({
        relation_tuples: [],
      });

      const ids = await reader.listDiaryIdsByAgent(AGENT_ID);

      expect(ids).toEqual([]);
    });

    it('returns empty array when relation_tuples is undefined', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({});

      const ids = await reader.listDiaryIdsByAgent(AGENT_ID);

      expect(ids).toEqual([]);
    });
  });
});
