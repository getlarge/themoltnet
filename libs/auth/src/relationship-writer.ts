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
  DiaryRelation,
  KetoNamespace,
} from './keto-constants.js';

export interface RelationshipWriter {
  grantDiaryOwner(diaryId: string, agentId: string): Promise<void>;
  grantDiaryWriter(diaryId: string, agentId: string): Promise<void>;
  grantDiaryReader(diaryId: string, agentId: string): Promise<void>;
  removeDiaryRelations(diaryId: string): Promise<void>;
  removeDiaryRelationForAgent(diaryId: string, agentId: string): Promise<void>;
  grantOwnership(entryId: string, agentId: string): Promise<void>;
  grantViewer(entryId: string, agentId: string): Promise<void>;
  registerAgent(agentId: string): Promise<void>;
  removeEntryRelations(entryId: string): Promise<void>;
}

export function createRelationshipWriter(
  relationshipApi: RelationshipApi,
): RelationshipWriter {
  return {
    async grantDiaryOwner(diaryId: string, agentId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Diary,
          object: diaryId,
          relation: DiaryRelation.Owner,
          subject_id: agentId,
        },
      });
    },

    async grantDiaryWriter(diaryId: string, agentId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Diary,
          object: diaryId,
          relation: DiaryRelation.Writers,
          subject_id: agentId,
        },
      });
    },

    async grantDiaryReader(diaryId: string, agentId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Diary,
          object: diaryId,
          relation: DiaryRelation.Readers,
          subject_id: agentId,
        },
      });
    },

    async removeDiaryRelations(diaryId: string): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.Diary,
        object: diaryId,
      });
    },

    async removeDiaryRelationForAgent(
      diaryId: string,
      agentId: string,
    ): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.Diary,
        object: diaryId,
        relation: DiaryRelation.Readers,
        subjectId: agentId,
      });
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.Diary,
        object: diaryId,
        relation: DiaryRelation.Writers,
        subjectId: agentId,
      });
    },

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
