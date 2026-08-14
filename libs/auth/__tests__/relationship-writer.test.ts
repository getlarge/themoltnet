import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRelationshipWriter,
  type RelationshipWriter,
} from '../src/relationship-writer.js';

interface MockRelationshipApi {
  createRelationship: ReturnType<typeof vi.fn>;
  deleteRelationships: ReturnType<typeof vi.fn>;
  getRelationships: ReturnType<typeof vi.fn>;
  patchRelationships: ReturnType<typeof vi.fn>;
}

function createMockRelationshipApi(): MockRelationshipApi {
  return {
    createRelationship: vi.fn(),
    deleteRelationships: vi.fn(),
    getRelationships: vi.fn().mockResolvedValue({ relation_tuples: [] }),
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

  it('writes exact ShellCommand relationships for runtime policies', async () => {
    mockRelationshipApi.patchRelationships.mockResolvedValue(undefined);

    await writer.writeRuntimePolicyEdges('policy-1', {
      addShellCommands: ['v1/gh/pr/view'],
      removeShellCommands: ['v1/npm/run/test%3Aunit'],
    });

    expect(mockRelationshipApi.patchRelationships).toHaveBeenCalledWith({
      relationshipPatch: [
        {
          action: 'insert',
          relation_tuple: {
            namespace: 'RuntimePolicy',
            object: 'policy-1',
            relation: 'command',
            subject_set: {
              namespace: 'ShellCommand',
              object: 'v1/gh/pr/view',
              relation: '',
            },
          },
        },
        {
          action: 'delete',
          relation_tuple: {
            namespace: 'RuntimePolicy',
            object: 'policy-1',
            relation: 'command',
            subject_set: {
              namespace: 'ShellCommand',
              object: 'v1/npm/run/test%3Aunit',
              relation: '',
            },
          },
        },
      ],
    });
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

  it('removes every relationship owned by an agent identity', async () => {
    mockRelationshipApi.deleteRelationships.mockResolvedValue({});

    await writer.removeAgentRelations(AGENT_ID);

    expect(mockRelationshipApi.deleteRelationships).toHaveBeenCalledWith({
      namespace: 'Agent',
      object: AGENT_ID,
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

  describe('removeEntryRelationsBatch', () => {
    const ENTRY_ID_1 = '770e8400-e29b-41d4-a716-446655440002';
    const ENTRY_ID_2 = '770e8400-e29b-41d4-a716-446655440003';
    const DIARY_ID_1 = '880e8400-e29b-41d4-a716-446655440004';
    const DIARY_ID_2 = '880e8400-e29b-41d4-a716-446655440005';

    it('sends one patchRelationships call with parent delete actions', async () => {
      mockRelationshipApi.patchRelationships.mockResolvedValue(undefined);

      await writer.removeEntryRelationsBatch([
        { id: ENTRY_ID_1, diaryId: DIARY_ID_1 },
        { id: ENTRY_ID_2, diaryId: DIARY_ID_2 },
      ]);

      expect(mockRelationshipApi.patchRelationships).toHaveBeenCalledOnce();
      expect(mockRelationshipApi.patchRelationships).toHaveBeenCalledWith({
        relationshipPatch: [
          {
            action: 'delete',
            relation_tuple: {
              namespace: 'DiaryEntry',
              object: ENTRY_ID_1,
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
              namespace: 'DiaryEntry',
              object: ENTRY_ID_2,
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
      await writer.removeEntryRelationsBatch([]);

      expect(mockRelationshipApi.patchRelationships).not.toHaveBeenCalled();
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

  describe('removeTaskRelationsBatch', () => {
    const TASK_ID_1 = 'cccc0000-0000-0000-0000-000000000001';
    const TASK_ID_2 = 'cccc0000-0000-0000-0000-000000000002';
    const TASK_DIARY_ID = 'dddd0000-0000-0000-0000-000000000001';
    const CLAIMANT_ID = 'eeee0000-0000-0000-0000-000000000001';

    it('removes every Task tuple, including ownership and explicit grants', async () => {
      mockRelationshipApi.patchRelationships.mockResolvedValue(undefined);
      mockRelationshipApi.getRelationships
        .mockResolvedValueOnce({
          relation_tuples: [
            {
              namespace: 'Task',
              object: TASK_ID_1,
              relation: 'team',
              subject_set: {
                namespace: 'Team',
                object: 'team-1',
                relation: '',
              },
            },
            {
              namespace: 'Task',
              object: TASK_ID_1,
              relation: 'writers',
              subject_set: {
                namespace: 'Group',
                object: 'group-1',
                relation: 'members',
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          relation_tuples: [
            {
              namespace: 'Task',
              object: TASK_ID_2,
              relation: 'parent',
              subject_set: {
                namespace: 'Diary',
                object: TASK_DIARY_ID,
                relation: '',
              },
            },
          ],
        });

      await writer.removeTaskRelationsBatch([
        {
          id: TASK_ID_1,
          diaryId: TASK_DIARY_ID,
          claimAgentId: CLAIMANT_ID,
        },
        { id: TASK_ID_2, diaryId: TASK_DIARY_ID, claimAgentId: null },
      ]);

      expect(mockRelationshipApi.patchRelationships).toHaveBeenCalledOnce();
      expect(mockRelationshipApi.patchRelationships).toHaveBeenCalledWith({
        relationshipPatch: [
          {
            action: 'delete',
            relation_tuple: {
              namespace: 'Task',
              object: TASK_ID_1,
              relation: 'team',
              subject_set: {
                namespace: 'Team',
                object: 'team-1',
                relation: '',
              },
            },
          },
          {
            action: 'delete',
            relation_tuple: {
              namespace: 'Task',
              object: TASK_ID_1,
              relation: 'writers',
              subject_set: {
                namespace: 'Group',
                object: 'group-1',
                relation: 'members',
              },
            },
          },
          {
            action: 'delete',
            relation_tuple: {
              namespace: 'Task',
              object: TASK_ID_2,
              relation: 'parent',
              subject_set: {
                namespace: 'Diary',
                object: TASK_DIARY_ID,
                relation: '',
              },
            },
          },
        ],
      });
    });

    it('is a no-op for empty array', async () => {
      await writer.removeTaskRelationsBatch([]);

      expect(mockRelationshipApi.patchRelationships).not.toHaveBeenCalled();
    });

    it('is a no-op when Keto has no task relations to remove', async () => {
      await writer.removeTaskRelationsBatch([
        { id: TASK_ID_1, diaryId: null, claimAgentId: null },
      ]);

      expect(mockRelationshipApi.patchRelationships).not.toHaveBeenCalled();
    });
  });

  describe('task ownership and grants', () => {
    it('writes team and provenance parent in one atomic patch', async () => {
      await writer.grantTaskOwnership('task-1', 'team-1', DIARY_ID);

      expect(mockRelationshipApi.patchRelationships).toHaveBeenCalledWith({
        relationshipPatch: [
          expect.objectContaining({
            action: 'insert',
            relation_tuple: expect.objectContaining({
              namespace: 'Task',
              object: 'task-1',
              relation: 'team',
            }),
          }),
          expect.objectContaining({
            action: 'insert',
            relation_tuple: expect.objectContaining({
              namespace: 'Task',
              object: 'task-1',
              relation: 'parent',
            }),
          }),
        ],
      });
    });

    it('preserves Group subject-set membership semantics for writers', async () => {
      await writer.grantTaskWriters('task-1', 'group-1', 'Group' as never);

      expect(mockRelationshipApi.createRelationship).toHaveBeenCalledWith({
        createRelationshipBody: expect.objectContaining({
          namespace: 'Task',
          object: 'task-1',
          relation: 'writers',
          subject_set: {
            namespace: 'Group',
            object: 'group-1',
            relation: 'members',
          },
        }),
      });
    });
  });
});
