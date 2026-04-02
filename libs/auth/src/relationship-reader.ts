/**
 * @moltnet/auth — Relationship Reader Service
 *
 * Wraps Ory Keto relationship read operations for querying
 * existing permission relationships.
 */

import type { RelationshipApi } from '@ory/client-fetch';

import {
  DiaryRelation,
  GroupRelation,
  KetoNamespace,
} from './keto-constants.js';

export interface GroupMemberTuple {
  subjectId: string;
  subjectNs: string;
}

export interface TeamMemberTuple {
  subjectId: string;
  subjectNs: string;
  relation: string;
}

export interface TeamIdWithRole {
  teamId: string;
  relation: string;
}

export interface DiaryGrantTuple {
  subjectId: string;
  subjectNs: string;
  role: 'writer' | 'manager';
  subjectRelation?: string;
}

export interface RelationshipReader {
  /** Returns all team IDs where the subject has any relationship (owner, manager, member). */
  listTeamIdsBySubject(subjectId: string): Promise<string[]>;
  /** Returns all team IDs with the subject's role in each team. */
  listTeamIdsAndRolesBySubject(subjectId: string): Promise<TeamIdWithRole[]>;
  /** Returns all members of a team with their roles. */
  listTeamMembers(teamId: string): Promise<TeamMemberTuple[]>;
  /** Returns all members of a group. */
  listGroupMembers(groupId: string): Promise<GroupMemberTuple[]>;
  /** Returns all per-diary grants (writers + managers). */
  listDiaryGrants(diaryId: string): Promise<DiaryGrantTuple[]>;
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
      if (tuple.object && tuple.relation) {
        const key = `${tuple.object}:${tuple.relation}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ teamId: tuple.object, relation: tuple.relation });
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
      // Deduplicate by teamId (prefer first occurrence)
      const seen = new Set<string>();
      const result: TeamIdWithRole[] = [];
      for (const entry of [...agentTeams, ...humanTeams]) {
        if (!seen.has(entry.teamId)) {
          seen.add(entry.teamId);
          result.push(entry);
        }
      }
      return result;
    },

    async listTeamMembers(teamId: string): Promise<TeamMemberTuple[]> {
      const members: TeamMemberTuple[] = [];
      let pageToken: string | undefined;

      do {
        const result = await relationshipApi.getRelationships({
          namespace: KetoNamespace.Team,
          object: teamId,
          pageToken,
        });
        for (const tuple of result.relation_tuples ?? []) {
          if (tuple.subject_set?.object && tuple.relation) {
            members.push({
              subjectId: tuple.subject_set.object,
              subjectNs: tuple.subject_set.namespace ?? '',
              relation: tuple.relation,
            });
          }
        }
        pageToken = result.next_page_token || undefined;
      } while (pageToken);

      return members;
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
  };
}
