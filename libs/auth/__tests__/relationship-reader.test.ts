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

  describe('listDiaryIdsBySubject', () => {
    it('queries Keto with subject_set for both Agent and Human namespaces', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({
        relation_tuples: [],
      });

      await reader.listDiaryIdsBySubject(AGENT_ID);

      // Two parallel calls: Agent namespace + Human namespace
      expect(mockRelationshipApi.getRelationships).toHaveBeenCalledTimes(2);
      expect(mockRelationshipApi.getRelationships).toHaveBeenCalledWith({
        namespace: 'Diary',
        subjectSetNamespace: 'Agent',
        subjectSetObject: AGENT_ID,
        subjectSetRelation: '',
        pageToken: undefined,
      });
      expect(mockRelationshipApi.getRelationships).toHaveBeenCalledWith({
        namespace: 'Diary',
        subjectSetNamespace: 'Human',
        subjectSetObject: AGENT_ID,
        subjectSetRelation: '',
        pageToken: undefined,
      });
    });

    it('returns diary IDs across all relations', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({
        relation_tuples: [
          { object: DIARY_ID_1, relation: 'owner', subject_id: AGENT_ID },
          { object: DIARY_ID_2, relation: 'writers', subject_id: AGENT_ID },
        ],
      });

      const ids = await reader.listDiaryIdsBySubject(AGENT_ID);

      // Both Agent and Human queries return same tuples in mock,
      // but deduplication merges them
      expect(ids).toContain(DIARY_ID_1);
      expect(ids).toContain(DIARY_ID_2);
    });

    it('deduplicates diary IDs across namespaces', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({
        relation_tuples: [
          { object: DIARY_ID_1, relation: 'owner', subject_id: AGENT_ID },
        ],
      });

      const ids = await reader.listDiaryIdsBySubject(AGENT_ID);

      // Both Agent and Human queries return DIARY_ID_1, but it appears once
      expect(ids.filter((id) => id === DIARY_ID_1)).toHaveLength(1);
    });

    it('returns empty array when no relation tuples exist', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({
        relation_tuples: [],
      });

      const ids = await reader.listDiaryIdsBySubject(AGENT_ID);

      expect(ids).toEqual([]);
    });

    it('returns empty array when relation_tuples is undefined', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({});

      const ids = await reader.listDiaryIdsBySubject(AGENT_ID);

      expect(ids).toEqual([]);
    });
  });
});
