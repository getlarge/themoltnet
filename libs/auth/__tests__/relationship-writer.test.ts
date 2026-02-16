import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRelationshipWriter,
  type RelationshipWriter,
} from '../src/relationship-writer.js';

interface MockRelationshipApi {
  createRelationship: ReturnType<typeof vi.fn>;
  deleteRelationships: ReturnType<typeof vi.fn>;
}

function createMockRelationshipApi(): MockRelationshipApi {
  return {
    createRelationship: vi.fn(),
    deleteRelationships: vi.fn(),
  };
}

const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_AGENT_ID = '660e8400-e29b-41d4-a716-446655440001';
const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';

describe('RelationshipWriter', () => {
  let mockRelationshipApi: MockRelationshipApi;
  let writer: RelationshipWriter;

  beforeEach(() => {
    mockRelationshipApi = createMockRelationshipApi();
    writer = createRelationshipWriter(mockRelationshipApi as any);
  });

  describe('grantOwnership', () => {
    it('creates owner relation tuple', async () => {
      mockRelationshipApi.createRelationship.mockResolvedValue({});

      await writer.grantOwnership(ENTRY_ID, AGENT_ID);

      expect(mockRelationshipApi.createRelationship).toHaveBeenCalledWith({
        createRelationshipBody: {
          namespace: 'DiaryEntry',
          object: ENTRY_ID,
          relation: 'owner',
          subject_id: AGENT_ID,
        },
      });
    });

    it('throws on API error', async () => {
      mockRelationshipApi.createRelationship.mockRejectedValue(
        new Error('Keto unavailable'),
      );

      await expect(writer.grantOwnership(ENTRY_ID, AGENT_ID)).rejects.toThrow(
        'Keto unavailable',
      );
    });
  });

  describe('grantViewer', () => {
    it('creates viewer relation tuple', async () => {
      mockRelationshipApi.createRelationship.mockResolvedValue({});

      await writer.grantViewer(ENTRY_ID, OTHER_AGENT_ID);

      expect(mockRelationshipApi.createRelationship).toHaveBeenCalledWith({
        createRelationshipBody: {
          namespace: 'DiaryEntry',
          object: ENTRY_ID,
          relation: 'viewer',
          subject_id: OTHER_AGENT_ID,
        },
      });
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
});
