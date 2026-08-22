/**
 * @moltnet/auth — Relationship Reader Service
 *
 * Wraps Ory Keto relationship read operations for querying
 * existing permission relationships.
 */

import type { RelationshipApi } from '@ory/client-fetch';

import type { TeamRelation } from './keto-constants.js';
import {
  DiaryRelation,
  GroupRelation,
  KetoNamespace,
  RuntimePolicyRelation,
  RuntimeProfileRelation,
  TaskRelation,
} from './keto-constants.js';
import {
  normalizeTeamRelation,
  teamRelationToRole,
  teamRoleRank,
} from './team-role.js';

export interface GroupMemberTuple {
  subjectId: string;
  subjectNs: string;
}

export interface TeamMemberTuple {
  subjectId: string;
  subjectNs: string;
  relation: TeamRelation;
}

export interface TeamIdWithRole {
  teamId: string;
  relation: TeamRelation;
}

export interface DiaryGrantTuple {
  subjectId: string;
  subjectNs: string;
  role: 'writer' | 'manager';
  subjectRelation?: string;
}

export type TaskGrantTuple = DiaryGrantTuple;

export interface RelationshipReader {
  /** Returns all team IDs where the subject has any role relationship. */
  listTeamIdsBySubject(subjectId: string): Promise<string[]>;
  /** Returns all team IDs with the subject's role in each team. */
  listTeamIdsAndRolesBySubject(subjectId: string): Promise<TeamIdWithRole[]>;
  /** Returns all members of a team with their roles. */
  listTeamMembers(teamId: string): Promise<TeamMemberTuple[]>;
  /** Returns whether the exact subject namespace currently belongs to a team. */
  isTeamMember(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  /** Returns all members of a group. */
  listGroupMembers(groupId: string): Promise<GroupMemberTuple[]>;
  /** Returns all group IDs where the subject is a direct member. */
  listGroupIdsBySubject(subjectId: string): Promise<string[]>;
  /** Returns all per-diary grants (writers + managers). */
  listDiaryGrants(diaryId: string): Promise<DiaryGrantTuple[]>;
  /** Returns all explicit per-task grants (writers + managers). */
  listTaskGrants(taskId: string): Promise<TaskGrantTuple[]>;
  /** Returns the RuntimePolicy IDs bound to a runtime profile. */
  listRuntimeProfilePolicies(profileId: string): Promise<string[]>;
  /** Returns the tool names granted by a runtime policy. */
  listRuntimePolicyTools(policyId: string): Promise<string[]>;
  /** Returns exact encoded ShellCommand object IDs granted by a policy. */
  listRuntimePolicyShellCommands(policyId: string): Promise<string[]>;
  /**
   * Returns the union of tool and ShellCommand grants for many policies using
   * one paginated Keto read per relation instead of two reads per policy.
   */
  listRuntimePolicyGrants?(
    policyIds: readonly string[],
  ): Promise<{ tools: string[]; shellCommands: string[] }>;
}

/**
 * Collects the `subject_set.object` of every tuple for a given
 * (namespace, object, relation), following pagination. Used by the
 * RuntimeProfile → policies → tools expand.
 */
async function listSubjectSetObjects(
  relationshipApi: RelationshipApi,
  params: {
    namespace: KetoNamespace;
    object: string;
    relation: string;
  },
): Promise<string[]> {
  const objects: string[] = [];
  let pageToken: string | undefined;

  do {
    const result = await relationshipApi.getRelationships({
      namespace: params.namespace,
      object: params.object,
      relation: params.relation,
      pageToken,
    });
    for (const tuple of result.relation_tuples ?? []) {
      if (tuple.subject_set?.object) {
        objects.push(tuple.subject_set.object);
      }
    }
    pageToken = result.next_page_token || undefined;
  } while (pageToken);

  return [...new Set(objects)];
}

async function listSubjectSetObjectsForObjects(
  relationshipApi: RelationshipApi,
  params: {
    namespace: KetoNamespace;
    objects: readonly string[];
    relation: string;
  },
): Promise<string[]> {
  if (params.objects.length === 0) return [];
  const selected = new Set(params.objects);
  const objects: string[] = [];
  let pageToken: string | undefined;
  do {
    const result = await relationshipApi.getRelationships({
      namespace: params.namespace,
      relation: params.relation,
      pageToken,
    });
    for (const tuple of result.relation_tuples ?? []) {
      if (
        tuple.object &&
        selected.has(tuple.object) &&
        tuple.subject_set?.object
      ) {
        objects.push(tuple.subject_set.object);
      }
    }
    pageToken = result.next_page_token || undefined;
  } while (pageToken);
  return [...new Set(objects)];
}

async function paginateTeamRoles(
  relationshipApi: RelationshipApi,
  params: Parameters<RelationshipApi['getRelationships']>[0],
): Promise<TeamIdWithRole[]> {
  const results: TeamIdWithRole[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;

  do {
    const result = await relationshipApi.getRelationships({
      ...params,
      pageToken,
    });
    for (const tuple of result.relation_tuples ?? []) {
      const relation = tuple.relation
        ? normalizeTeamRelation(tuple.relation)
        : null;
      if (tuple.object && relation) {
        const key = `${tuple.object}:${relation}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ teamId: tuple.object, relation });
        }
      }
    }
    pageToken = result.next_page_token || undefined;
  } while (pageToken);

  return results;
}

export function createRelationshipReader(
  relationshipApi: RelationshipApi,
): RelationshipReader {
  return {
    async listTeamIdsBySubject(subjectId: string): Promise<string[]> {
      const roles = await this.listTeamIdsAndRolesBySubject(subjectId);
      return [...new Set(roles.map((r) => r.teamId))];
    },

    async listTeamIdsAndRolesBySubject(
      subjectId: string,
    ): Promise<TeamIdWithRole[]> {
      // Tuples are written with subject_set (Agent or Human namespace).
      // Query both and merge.
      const [agentTeams, humanTeams] = await Promise.all([
        paginateTeamRoles(relationshipApi, {
          namespace: KetoNamespace.Team,
          subjectSetNamespace: KetoNamespace.Agent,
          subjectSetObject: subjectId,
          subjectSetRelation: '',
        }),
        paginateTeamRoles(relationshipApi, {
          namespace: KetoNamespace.Team,
          subjectSetNamespace: KetoNamespace.Human,
          subjectSetObject: subjectId,
          subjectSetRelation: '',
        }),
      ]);
      // Deduplicate by teamId and keep the highest-privilege relation.
      const bestByTeamId = new Map<string, TeamIdWithRole>();
      for (const entry of [...agentTeams, ...humanTeams]) {
        const existing = bestByTeamId.get(entry.teamId);
        if (
          !existing ||
          teamRoleRank(teamRelationToRole(entry.relation)) >
            teamRoleRank(teamRelationToRole(existing.relation))
        ) {
          bestByTeamId.set(entry.teamId, entry);
        }
      }
      return [...bestByTeamId.values()];
    },

    async listTeamMembers(teamId: string): Promise<TeamMemberTuple[]> {
      const members = new Map<string, TeamMemberTuple>();
      let pageToken: string | undefined;

      do {
        const result = await relationshipApi.getRelationships({
          namespace: KetoNamespace.Team,
          object: teamId,
          pageToken,
        });
        for (const tuple of result.relation_tuples ?? []) {
          const relation = tuple.relation
            ? normalizeTeamRelation(tuple.relation)
            : null;
          if (tuple.subject_set?.object && relation) {
            const member: TeamMemberTuple = {
              subjectId: tuple.subject_set.object,
              subjectNs: tuple.subject_set.namespace ?? '',
              relation,
            };
            const key = `${member.subjectNs}:${member.subjectId}`;
            const existing = members.get(key);
            if (
              !existing ||
              teamRoleRank(teamRelationToRole(member.relation)) >
                teamRoleRank(teamRelationToRole(existing.relation))
            ) {
              members.set(key, member);
            }
          }
        }
        pageToken = result.next_page_token || undefined;
      } while (pageToken);

      return [...members.values()];
    },

    async isTeamMember(
      teamId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      const members = await this.listTeamMembers(teamId);
      return members.some(
        (member) =>
          member.subjectId === subjectId &&
          member.subjectNs === String(subjectNs),
      );
    },

    async listGroupMembers(groupId: string): Promise<GroupMemberTuple[]> {
      const members: GroupMemberTuple[] = [];
      let pageToken: string | undefined;

      do {
        const result = await relationshipApi.getRelationships({
          namespace: KetoNamespace.Group,
          object: groupId,
          relation: GroupRelation.Members,
          pageToken,
        });
        for (const tuple of result.relation_tuples ?? []) {
          if (tuple.subject_set?.object) {
            members.push({
              subjectId: tuple.subject_set.object,
              subjectNs: tuple.subject_set.namespace ?? '',
            });
          }
        }
        pageToken = result.next_page_token || undefined;
      } while (pageToken);

      return members;
    },

    async listGroupIdsBySubject(subjectId: string): Promise<string[]> {
      const groupIds = new Set<string>();
      const listNamespace = async (subjectSetNamespace: KetoNamespace) => {
        const ids: string[] = [];
        let pageToken: string | undefined;
        do {
          const result = await relationshipApi.getRelationships({
            namespace: KetoNamespace.Group,
            relation: GroupRelation.Members,
            subjectSetNamespace,
            subjectSetObject: subjectId,
            subjectSetRelation: '',
            pageToken,
          });
          for (const tuple of result.relation_tuples ?? []) {
            if (tuple.object) ids.push(tuple.object);
          }
          pageToken = result.next_page_token || undefined;
        } while (pageToken);
        return ids;
      };
      const namespaceResults = await Promise.all([
        listNamespace(KetoNamespace.Agent),
        listNamespace(KetoNamespace.Human),
      ]);
      for (const ids of namespaceResults) {
        for (const id of ids) groupIds.add(id);
      }
      return [...groupIds];
    },

    async listDiaryGrants(diaryId: string): Promise<DiaryGrantTuple[]> {
      const grants: DiaryGrantTuple[] = [];

      for (const [relation, role] of [
        [DiaryRelation.Writers, 'writer'],
        [DiaryRelation.Managers, 'manager'],
      ] as const) {
        let pageToken: string | undefined;
        do {
          const result = await relationshipApi.getRelationships({
            namespace: KetoNamespace.Diary,
            object: diaryId,
            relation,
            pageToken,
          });
          for (const tuple of result.relation_tuples ?? []) {
            if (tuple.subject_set?.object) {
              grants.push({
                subjectId: tuple.subject_set.object,
                subjectNs: tuple.subject_set.namespace ?? '',
                role,
                subjectRelation: tuple.subject_set.relation || undefined,
              });
            }
          }
          pageToken = result.next_page_token || undefined;
        } while (pageToken);
      }

      return grants;
    },

    async listTaskGrants(taskId: string): Promise<TaskGrantTuple[]> {
      const grants: TaskGrantTuple[] = [];

      for (const [relation, role] of [
        [TaskRelation.Writers, 'writer'],
        [TaskRelation.Managers, 'manager'],
      ] as const) {
        let pageToken: string | undefined;
        do {
          const result = await relationshipApi.getRelationships({
            namespace: KetoNamespace.Task,
            object: taskId,
            relation,
            pageToken,
          });
          for (const tuple of result.relation_tuples ?? []) {
            if (tuple.subject_set?.object) {
              grants.push({
                subjectId: tuple.subject_set.object,
                subjectNs: tuple.subject_set.namespace ?? '',
                role,
                subjectRelation: tuple.subject_set.relation || undefined,
              });
            }
          }
          pageToken = result.next_page_token || undefined;
        } while (pageToken);
      }

      return grants;
    },

    async listRuntimeProfilePolicies(profileId: string): Promise<string[]> {
      return listSubjectSetObjects(relationshipApi, {
        namespace: KetoNamespace.RuntimeProfile,
        object: profileId,
        relation: RuntimeProfileRelation.Policies,
      });
    },

    async listRuntimePolicyTools(policyId: string): Promise<string[]> {
      return listSubjectSetObjects(relationshipApi, {
        namespace: KetoNamespace.RuntimePolicy,
        object: policyId,
        relation: RuntimePolicyRelation.Tool,
      });
    },

    async listRuntimePolicyShellCommands(policyId: string): Promise<string[]> {
      return listSubjectSetObjects(relationshipApi, {
        namespace: KetoNamespace.RuntimePolicy,
        object: policyId,
        relation: RuntimePolicyRelation.Command,
      });
    },

    async listRuntimePolicyGrants(
      policyIds: readonly string[],
    ): Promise<{ tools: string[]; shellCommands: string[] }> {
      const [tools, shellCommands] = await Promise.all([
        listSubjectSetObjectsForObjects(relationshipApi, {
          namespace: KetoNamespace.RuntimePolicy,
          objects: policyIds,
          relation: RuntimePolicyRelation.Tool,
        }),
        listSubjectSetObjectsForObjects(relationshipApi, {
          namespace: KetoNamespace.RuntimePolicy,
          objects: policyIds,
          relation: RuntimePolicyRelation.Command,
        }),
      ]);
      return { tools, shellCommands };
    },
  };
}
