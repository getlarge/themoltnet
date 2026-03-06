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
      const ids = new Set<string>();
      let pageToken: string | undefined;

      do {
        const result = await relationshipApi.getRelationships({
          namespace: KetoNamespace.Diary,
          subjectId: agentId,
          pageToken,
        });
        for (const tuple of result.relation_tuples ?? []) {
          if (tuple.object) ids.add(tuple.object);
        }
        pageToken = result.next_page_token || undefined;
      } while (pageToken);

      return [...ids];
    },
  };
}
