/**
 * @moltnet/auth — Relationship Reader Service
 *
 * Wraps Ory Keto relationship read operations for querying
 * existing permission relationships.
 */

import type { RelationshipApi } from '@ory/client-fetch';

import { type DiaryRelation, KetoNamespace } from './keto-constants.js';

export interface RelationshipReader {
  /** Returns all diary IDs where the agent has the given relation. */
  listDiaryIdsByAgent(
    agentId: string,
    relation: DiaryRelation,
  ): Promise<string[]>;
}

export function createRelationshipReader(
  relationshipApi: RelationshipApi,
): RelationshipReader {
  return {
    async listDiaryIdsByAgent(
      agentId: string,
      relation: DiaryRelation,
    ): Promise<string[]> {
      const result = await relationshipApi.getRelationships({
        namespace: KetoNamespace.Diary,
        relation,
        subjectId: agentId,
      });
      return result.relation_tuples?.map((t) => t.object).filter(Boolean) ?? [];
    },
  };
}
