/**
 * @moltnet/auth — Relationship Reader Service
 *
 * Wraps Ory Keto relationship read operations for querying
 * existing permission relationships.
 */

import type { RelationshipApi } from '@ory/client-fetch';

import { KetoNamespace } from './keto-constants.js';

export interface TeamMemberTuple {
  subjectId: string;
  subjectNs: string;
  relation: string;
}

export interface RelationshipReader {
  /** Returns all diary IDs where the subject has any relationship (owner, writers, readers, or via team). */
  listDiaryIdsByAgent(agentId: string): Promise<string[]>;
  /** Returns all team IDs where the subject has any relationship (owner, manager, member). */
  listTeamIdsBySubject(subjectId: string): Promise<string[]>;
  /** Returns all members of a team with their roles. */
  listTeamMembers(teamId: string): Promise<TeamMemberTuple[]>;
}

async function paginateRelationships(
  relationshipApi: RelationshipApi,
  params: Parameters<RelationshipApi['getRelationships']>[0],
  extract: (tuple: { object?: string }) => string | undefined,
): Promise<string[]> {
  const ids = new Set<string>();
  let pageToken: string | undefined;

  do {
    const result = await relationshipApi.getRelationships({
      ...params,
      pageToken,
    });
    for (const tuple of result.relation_tuples ?? []) {
      const id = extract(tuple);
      if (id) ids.add(id);
    }
    pageToken = result.next_page_token || undefined;
  } while (pageToken);

  return [...ids];
}

export function createRelationshipReader(
  relationshipApi: RelationshipApi,
): RelationshipReader {
  return {
    async listDiaryIdsByAgent(agentId: string): Promise<string[]> {
      return paginateRelationships(
        relationshipApi,
        { namespace: KetoNamespace.Diary, subjectId: agentId },
        (tuple) => tuple.object,
      );
    },

    async listTeamIdsBySubject(subjectId: string): Promise<string[]> {
      // Tuples are written with subject_set (Agent or Human namespace).
      // Query both and merge.
      const [agentTeams, humanTeams] = await Promise.all([
        paginateRelationships(
          relationshipApi,
          {
            namespace: KetoNamespace.Team,
            subjectSetNamespace: KetoNamespace.Agent,
            subjectSetObject: subjectId,
            subjectSetRelation: '',
          },
          (tuple) => tuple.object,
        ),
        paginateRelationships(
          relationshipApi,
          {
            namespace: KetoNamespace.Team,
            subjectSetNamespace: KetoNamespace.Human,
            subjectSetObject: subjectId,
            subjectSetRelation: '',
          },
          (tuple) => tuple.object,
        ),
      ]);
      return [...new Set([...agentTeams, ...humanTeams])];
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
  };
}
