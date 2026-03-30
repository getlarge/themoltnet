/**
 * @moltnet/auth — Relationship Writer Service
 *
 * Wraps Ory Keto relationship write operations for managing
 * diary entry and agent permission relationships.
 */

import type { RelationshipApi } from '@ory/client-fetch';

import {
  AgentRelation,
  ContextPackRelation,
  DiaryEntryRelation,
  DiaryRelation,
  HumanRelation,
  KetoNamespace,
  TeamRelation,
} from './keto-constants.js';

export interface RelationshipWriter {
  // Diary relations (legacy direct + team-based)
  grantDiaryOwner(diaryId: string, agentId: string): Promise<void>;
  grantDiaryWriter(diaryId: string, agentId: string): Promise<void>;
  grantDiaryReader(diaryId: string, agentId: string): Promise<void>;
  grantDiaryTeam(diaryId: string, teamId: string): Promise<void>;
  removeDiaryTeam(diaryId: string): Promise<void>;
  removeDiaryRelations(diaryId: string): Promise<void>;
  removeDiaryRelationForAgent(diaryId: string, agentId: string): Promise<void>;
  // Entry + pack relations
  grantEntryParent(entryId: string, diaryId: string): Promise<void>;
  grantPackParent(packId: string, diaryId: string): Promise<void>;
  removeEntryRelations(entryId: string): Promise<void>;
  removePackRelations(packId: string): Promise<void>;
  removePackRelationsBatch(
    packs: Array<{ id: string; diaryId: string }>,
  ): Promise<void>;
  // Identity relations
  registerAgent(agentId: string): Promise<void>;
  registerHuman(humanId: string): Promise<void>;
  // Team membership (Keto is the sole membership store)
  // subjectNs: KetoNamespace.Agent or KetoNamespace.Human
  grantTeamOwner(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
  grantTeamManager(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
  grantTeamMember(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
  removeTeamMemberRelation(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
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

    async grantEntryParent(entryId: string, diaryId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.DiaryEntry,
          object: entryId,
          relation: DiaryEntryRelation.Parent,
          subject_set: {
            namespace: KetoNamespace.Diary,
            object: diaryId,
            relation: '',
          },
        },
      });
    },

    async grantPackParent(packId: string, diaryId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.ContextPack,
          object: packId,
          relation: ContextPackRelation.Parent,
          subject_set: {
            namespace: KetoNamespace.Diary,
            object: diaryId,
            relation: '',
          },
        },
      });
    },

    async removePackRelations(packId: string): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.ContextPack,
        object: packId,
      });
    },

    async removePackRelationsBatch(
      packs: Array<{ id: string; diaryId: string }>,
    ): Promise<void> {
      if (packs.length === 0) return;

      await relationshipApi.patchRelationships({
        relationshipPatch: packs.map((pack) => ({
          action: 'delete' as const,
          relation_tuple: {
            namespace: KetoNamespace.ContextPack,
            object: pack.id,
            relation: ContextPackRelation.Parent,
            subject_set: {
              namespace: KetoNamespace.Diary,
              object: pack.diaryId,
              relation: '',
            },
          },
        })),
      });
    },

    async grantDiaryTeam(diaryId: string, teamId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Diary,
          object: diaryId,
          relation: DiaryRelation.Team,
          subject_set: {
            namespace: KetoNamespace.Team,
            object: teamId,
            relation: '',
          },
        },
      });
    },

    async removeDiaryTeam(diaryId: string): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.Diary,
        object: diaryId,
        relation: DiaryRelation.Team,
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

    async registerHuman(humanId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Human,
          object: humanId,
          relation: HumanRelation.Self,
          subject_id: humanId,
        },
      });
    },

    async grantTeamOwner(
      teamId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Team,
          object: teamId,
          relation: TeamRelation.Owner,
          subject_set: {
            namespace: subjectNs,
            object: subjectId,
            relation: '',
          },
        },
      });
    },

    async grantTeamManager(
      teamId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Team,
          object: teamId,
          relation: TeamRelation.Manager,
          subject_set: {
            namespace: subjectNs,
            object: subjectId,
            relation: '',
          },
        },
      });
    },

    async grantTeamMember(
      teamId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Team,
          object: teamId,
          relation: TeamRelation.Member,
          subject_set: {
            namespace: subjectNs,
            object: subjectId,
            relation: '',
          },
        },
      });
    },

    async removeTeamMemberRelation(
      teamId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<void> {
      await relationshipApi.patchRelationships({
        relationshipPatch: [
          TeamRelation.Owner,
          TeamRelation.Manager,
          TeamRelation.Member,
        ].map((relation) => ({
          action: 'delete' as const,
          relation_tuple: {
            namespace: KetoNamespace.Team,
            object: teamId,
            relation,
            subject_set: {
              namespace: subjectNs,
              object: subjectId,
              relation: '',
            },
          },
        })),
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
