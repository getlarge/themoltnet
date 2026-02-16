/**
 * @moltnet/auth — Relationship Writer Service
 *
 * Wraps Ory Keto relationship write operations for managing
 * diary entry and agent permission relationships.
 */

import type { RelationshipApi } from '@ory/client-fetch';

import {
  AgentRelation,
  DiaryEntryRelation,
  KetoNamespace,
} from './keto-constants.js';

export interface RelationshipWriter {
  grantOwnership(entryId: string, agentId: string): Promise<void>;
  grantViewer(entryId: string, agentId: string): Promise<void>;
  registerAgent(agentId: string): Promise<void>;
  removeEntryRelations(entryId: string): Promise<void>;
}

export function createRelationshipWriter(
  relationshipApi: RelationshipApi,
): RelationshipWriter {
  return {
    async grantOwnership(entryId: string, agentId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.DiaryEntry,
          object: entryId,
          relation: DiaryEntryRelation.Owner,
          subject_id: agentId,
        },
      });
    },

    async grantViewer(entryId: string, agentId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.DiaryEntry,
          object: entryId,
          relation: DiaryEntryRelation.Viewer,
          subject_id: agentId,
        },
      });
    },

    async registerAgent(agentId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Agent,
          object: agentId,
          relation: AgentRelation.Self,
          subject_id: agentId,
        },
      });
    },

    async removeEntryRelations(entryId: string): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.DiaryEntry,
        object: entryId,
      });
    },
  };
}
