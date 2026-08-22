import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KetoNamespace } from '../src/keto-constants.js';
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

  describe('listTeamIdsAndRolesBySubject', () => {
    it('keeps the highest role when the same team has multiple tuples', async () => {
      mockRelationshipApi.getRelationships
        .mockResolvedValueOnce({
          relation_tuples: [
            {
              object: TEAM_ID_1,
              relation: 'members',
              subject_set: { object: AGENT_ID, namespace: 'Agent' },
            },
            {
              object: TEAM_ID_1,
              relation: 'executors',
              subject_set: { object: AGENT_ID, namespace: 'Agent' },
            },
            {
              object: TEAM_ID_1,
              relation: 'managers',
              subject_set: { object: AGENT_ID, namespace: 'Agent' },
            },
          ],
        })
        .mockResolvedValueOnce({ relation_tuples: [] });

      const roles = await reader.listTeamIdsAndRolesBySubject(AGENT_ID);

      expect(roles).toEqual([{ teamId: TEAM_ID_1, relation: 'managers' }]);
    });

    it('returns executor when it is the highest projected role', async () => {
      mockRelationshipApi.getRelationships
        .mockResolvedValueOnce({
          relation_tuples: [
            {
              object: TEAM_ID_1,
              relation: 'members',
              subject_set: { object: AGENT_ID, namespace: 'Agent' },
            },
            {
              object: TEAM_ID_1,
              relation: 'executors',
              subject_set: { object: AGENT_ID, namespace: 'Agent' },
            },
          ],
        })
        .mockResolvedValueOnce({ relation_tuples: [] });

      await expect(
        reader.listTeamIdsAndRolesBySubject(AGENT_ID),
      ).resolves.toEqual([{ teamId: TEAM_ID_1, relation: 'executors' }]);
    });
  });

  describe('listGroupIdsBySubject', () => {
    it('queries agent and human memberships and deduplicates groups', async () => {
      mockRelationshipApi.getRelationships
        .mockResolvedValueOnce({
          relation_tuples: [{ object: TEAM_ID_1 }, { object: TEAM_ID_2 }],
          next_page_token: 'agent-page-2',
        })
        .mockResolvedValueOnce({
          relation_tuples: [{ object: TEAM_ID_1 }],
        })
        .mockResolvedValueOnce({
          relation_tuples: [{ object: TEAM_ID_2 }],
        });

      await expect(reader.listGroupIdsBySubject(AGENT_ID)).resolves.toEqual([
        TEAM_ID_1,
        TEAM_ID_2,
      ]);
      expect(mockRelationshipApi.getRelationships).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          namespace: KetoNamespace.Group,
          relation: 'members',
          subjectSetNamespace: KetoNamespace.Agent,
          subjectSetObject: AGENT_ID,
        }),
      );
      expect(mockRelationshipApi.getRelationships).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectSetNamespace: KetoNamespace.Human,
          subjectSetObject: AGENT_ID,
        }),
      );
    });
  });

  describe('listTaskGrants', () => {
    it('reads writers and managers with paginated Group semantics intact', async () => {
      mockRelationshipApi.getRelationships
        .mockResolvedValueOnce({
          relation_tuples: [
            {
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
              subject_set: {
                namespace: 'Human',
                object: 'human-1',
                relation: '',
              },
            },
          ],
        });

      await expect(reader.listTaskGrants('task-1')).resolves.toEqual([
        {
          subjectId: 'group-1',
          subjectNs: 'Group',
          role: 'writer',
          subjectRelation: 'members',
        },
        {
          subjectId: 'human-1',
          subjectNs: 'Human',
          role: 'manager',
          subjectRelation: undefined,
        },
      ]);
    });
  });

  describe('isTeamMember', () => {
    it('matches both the subject ID and namespace', async () => {
      mockRelationshipApi.getRelationships.mockResolvedValue({
        relation_tuples: [
          {
            relation: 'members',
            subject_set: { object: AGENT_ID, namespace: KetoNamespace.Agent },
          },
        ],
      });

      await expect(
        reader.isTeamMember(TEAM_ID_1, AGENT_ID, KetoNamespace.Agent),
      ).resolves.toBe(true);
      await expect(
        reader.isTeamMember(TEAM_ID_1, AGENT_ID, KetoNamespace.Human),
      ).resolves.toBe(false);
    });
  });

  describe('listRuntimePolicyGrants', () => {
    it('batches many policy grants into one read per relation', async () => {
      mockRelationshipApi.getRelationships
        .mockResolvedValueOnce({
          relation_tuples: [
            {
              object: 'policy-1',
              subject_set: { object: 'git' },
            },
            {
              object: 'other-policy',
              subject_set: { object: 'curl' },
            },
          ],
        })
        .mockResolvedValueOnce({
          relation_tuples: [
            {
              object: 'policy-2',
              subject_set: { object: 'v1/gh/pr/view' },
            },
          ],
        });

      await expect(
        reader.listRuntimePolicyGrants?.(['policy-1', 'policy-2']),
      ).resolves.toEqual({
        tools: ['git'],
        shellCommands: ['v1/gh/pr/view'],
      });
      expect(mockRelationshipApi.getRelationships).toHaveBeenCalledTimes(2);
      expect(mockRelationshipApi.getRelationships).toHaveBeenCalledWith({
        namespace: KetoNamespace.RuntimePolicy,
        relation: 'tool',
        pageToken: undefined,
      });
      expect(mockRelationshipApi.getRelationships).toHaveBeenCalledWith({
        namespace: KetoNamespace.RuntimePolicy,
        relation: 'command',
        pageToken: undefined,
      });
    });
  });
});
