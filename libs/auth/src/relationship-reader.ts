/**
 * @moltnet/auth — Relationship Reader Service
 *
 * Wraps Ory Keto relationship read operations for querying
 * existing permission relationships.
 */

import type { RelationshipApi } from '@ory/client-fetch';

import { KetoNamespace } from './keto-constants.js';

export interface RelationshipReader {
  /** Returns all diary IDs where the agent has any relationship (owner, writers, readers). */
  listDiaryIdsByAgent(agentId: string): Promise<string[]>;
}

export function createRelationshipReader(
  relationshipApi: RelationshipApi,
): RelationshipReader {
  return {
    async listDiaryIdsByAgent(agentId: string): Promise<string[]> {
      const result = await relationshipApi.getRelationships({
        namespace: KetoNamespace.Diary,
        subjectId: agentId,
      });
      const ids =
        result.relation_tuples?.map((t) => t.object).filter(Boolean) ?? [];
      return [...new Set(ids)];
    },
  };
}
