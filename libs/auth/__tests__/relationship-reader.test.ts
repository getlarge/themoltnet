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
const TEAM_ID_1 = '880e8400-e29b-41d4-a716-446655440001';
const TEAM_ID_2 = '880e8400-e29b-41d4-a716-446655440002';

describe('RelationshipReader', () => {
  let mockRelationshipApi: MockRelationshipApi;
  let reader: RelationshipReader;

  beforeEach(() => {
    mockRelationshipApi = createMockRelationshipApi();
    reader = createRelationshipReader(mockRelationshipApi as any);
  });

  describe('listTeamIdsBySubject', () => {
    it('returns team IDs from relation tuples', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({
        relation_tuples: [
          { object: TEAM_ID_1, relation: 'owners', subject_id: AGENT_ID },
          { object: TEAM_ID_2, relation: 'members', subject_id: AGENT_ID },
        ],
      });

      const ids = await reader.listTeamIdsBySubject(AGENT_ID);

      expect(ids).toContain(TEAM_ID_1);
      expect(ids).toContain(TEAM_ID_2);
    });

    it('returns empty array when no relation tuples exist', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({
        relation_tuples: [],
      });

      const ids = await reader.listTeamIdsBySubject(AGENT_ID);

      expect(ids).toEqual([]);
    });
  });
});
