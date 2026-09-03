import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KetoNamespace } from '../src/keto-constants.js';
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

  describe('team role projections', () => {
    const TEAM_ID = '00000000-0000-4000-b000-000000000001';
    const allRelations = ['owners', 'managers', 'executors', 'members'];

    it.each([
      ['owner', ['owners', 'executors']],
      ['manager', ['managers', 'executors']],
      ['executor', ['executors', 'members']],
      ['member', ['members']],
    ] as const)(
      'atomically projects an agent %s role',
      async (role, expectedRelations) => {
        mockRelationshipApi.patchRelationships.mockResolvedValue(undefined);

        const grant = {
          owner: writer.grantTeamOwners,
          manager: writer.grantTeamManagers,
          executor: writer.grantTeamExecutors,
          member: writer.grantTeamMembers,
        }[role];
        await grant(TEAM_ID, AGENT_ID, KetoNamespace.Agent);

        expect(mockRelationshipApi.patchRelationships).toHaveBeenCalledOnce();
        const patches = mockRelationshipApi.patchRelationships.mock.calls[0]![0]
          .relationshipPatch as Array<{
          action: string;
          relation_tuple: { relation: string };
        }>;
        expect(
          patches
            .filter((patch) => patch.action === 'delete')
            .map((patch) => patch.relation_tuple.relation),
        ).toEqual(
          allRelations.filter(
            (relation) => !new Set<string>(expectedRelations).has(relation),
          ),
        );
        expect(
          patches
            .filter((patch) => patch.action === 'insert')
            .map((patch) => patch.relation_tuple.relation),
        ).toEqual(expectedRelations);
      },
    );

    it.each([
      ['owner', ['owners']],
      ['manager', ['managers']],
      ['member', ['members']],
    ] as const)(
      'keeps a human %s projection singular',
      async (role, expected) => {
        mockRelationshipApi.patchRelationships.mockResolvedValue(undefined);
        const grant = {
          owner: writer.grantTeamOwners,
          manager: writer.grantTeamManagers,
          member: writer.grantTeamMembers,
        }[role];

        await grant(TEAM_ID, AGENT_ID, KetoNamespace.Human);

        const patches = mockRelationshipApi.patchRelationships.mock.calls[0]![0]
          .relationshipPatch as Array<{
          action: string;
          relation_tuple: { relation: string };
        }>;
        expect(
          patches
            .filter((patch) => patch.action === 'insert')
            .map((patch) => patch.relation_tuple.relation),
        ).toEqual(expected);
        expect(
          patches
            .filter((patch) => patch.action === 'delete')
            .map((patch) => patch.relation_tuple.relation),
        ).toEqual(
          allRelations.filter(
            (relation) => !new Set<string>(expected).has(relation),
          ),
        );
      },
    );

    it('rejects an executor projection for a human before writing', async () => {
      await expect(
        writer.grantTeamExecutors(TEAM_ID, AGENT_ID, KetoNamespace.Human),
      ).rejects.toThrow('agent-only');
      expect(mockRelationshipApi.patchRelationships).not.toHaveBeenCalled();
    });

    it('deletes every role tuple when removing a member', async () => {
      mockRelationshipApi.patchRelationships.mockResolvedValue(undefined);

      await writer.removeTeamMemberRelation(
        TEAM_ID,
        AGENT_ID,
        KetoNamespace.Agent,
      );

      const patches = mockRelationshipApi.patchRelationships.mock.calls[0]![0]
        .relationshipPatch as Array<{
        action: string;
        relation_tuple: { relation: string };
      }>;
      expect(patches).toHaveLength(4);
      expect(patches.map((patch) => patch.relation_tuple.relation)).toEqual(
        allRelations,
      );
      expect(patches.every((patch) => patch.action === 'delete')).toBe(true);
    });
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
    it('creates agent self relation as a typed subject set', async () => {
      mockRelationshipApi.createRelationship.mockResolvedValue({});

      await writer.registerAgent(AGENT_ID);

      expect(mockRelationshipApi.createRelationship).toHaveBeenCalledWith({
        createRelationshipBody: {
          namespace: 'Agent',
          object: AGENT_ID,
          relation: 'self',
          subject_set: {
            namespace: 'Agent',
            object: AGENT_ID,
            relation: '',
          },
        },
      });
    });
  });

  describe('registerHuman', () => {
    it('creates human self relation as a typed subject set', async () => {
      mockRelationshipApi.createRelationship.mockResolvedValue({});

      await writer.registerHuman(AGENT_ID);

      expect(mockRelationshipApi.createRelationship).toHaveBeenCalledWith({
        createRelationshipBody: {
          namespace: 'Human',
          object: AGENT_ID,
          relation: 'self',
          subject_set: {
            namespace: 'Human',
            object: AGENT_ID,
            relation: '',
          },
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

    it('removes every Task tuple with bounded relationship patches', async () => {
      const firstPage = Array.from({ length: 100 }, (_, index) => ({
        namespace: 'Task',
        object: index % 2 === 0 ? TASK_ID_1 : TASK_ID_2,
        relation: `relation-${index}`,
        subject_id: `subject-${index}`,
      }));
      const finalTuple = {
        namespace: 'Task',
        object: TASK_ID_1,
        relation: 'writers',
        subject_id: 'final-subject',
      };
      mockRelationshipApi.getRelationships
        .mockResolvedValueOnce({
          relation_tuples: firstPage,
          next_page_token: 'page-2',
        })
        .mockResolvedValueOnce({
          relation_tuples: [
            finalTuple,
            {
              namespace: 'Task',
              object: 'unrelated-task',
              relation: 'team',
              subject_id: 'unrelated-team',
            },
          ],
          next_page_token: '',
        });

      await writer.removeTaskRelationsBatch([
        { id: TASK_ID_1 },
        { id: TASK_ID_2 },
      ]);

      expect(mockRelationshipApi.getRelationships).toHaveBeenNthCalledWith(1, {
        namespace: 'Task',
        pageSize: 100,
        pageToken: undefined,
      });
      expect(mockRelationshipApi.getRelationships).toHaveBeenNthCalledWith(2, {
        namespace: 'Task',
        pageSize: 100,
        pageToken: 'page-2',
      });
      expect(mockRelationshipApi.patchRelationships).toHaveBeenCalledTimes(2);
      expect(
        mockRelationshipApi.patchRelationships.mock.calls[0]?.[0]
          .relationshipPatch,
      ).toHaveLength(100);
      expect(mockRelationshipApi.patchRelationships).toHaveBeenLastCalledWith({
        relationshipPatch: [{ action: 'delete', relation_tuple: finalTuple }],
      });
    });

    it('is a no-op for empty array', async () => {
      await writer.removeTaskRelationsBatch([]);

      expect(mockRelationshipApi.getRelationships).not.toHaveBeenCalled();
      expect(mockRelationshipApi.patchRelationships).not.toHaveBeenCalled();
    });

    it('is idempotent when no Task tuples remain', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({
        relation_tuples: [],
        next_page_token: '',
      });

      await writer.removeTaskRelationsBatch([{ id: TASK_ID_1 }]);

      expect(mockRelationshipApi.getRelationships).toHaveBeenCalledOnce();
      expect(mockRelationshipApi.patchRelationships).not.toHaveBeenCalled();
    });
  });

  describe('task ownership and grants', () => {
    it('writes only the owning team relation', async () => {
      await writer.grantTaskOwnership('task-1', 'team-1');

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
