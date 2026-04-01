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
  GroupRelation,
  HumanRelation,
  KetoNamespace,
  TeamRelation,
} from './keto-constants.js';

export interface RelationshipWriter {
  // Diary relations (team-based only)
  // TODO(chunk-3): add grantDiaryWriters/grantDiaryManagers for per-diary grants
  grantDiaryTeam(diaryId: string, teamId: string): Promise<void>;
  removeDiaryTeam(diaryId: string): Promise<void>;
  removeDiaryRelations(diaryId: string): Promise<void>;
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
  grantTeamOwners(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
  grantTeamManagers(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
  grantTeamMembers(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
  removeTeamMemberRelation(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
  // Group management (Keto is the sole membership store)
  grantGroupParent(groupId: string, teamId: string): Promise<void>;
  grantGroupMember(
    groupId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
  removeGroupMember(
    groupId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
  removeGroupRelations(groupId: string): Promise<void>;
}

export function createRelationshipWriter(
  relationshipApi: RelationshipApi,
): RelationshipWriter {
  return {
    async removeDiaryRelations(diaryId: string): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.Diary,
        object: diaryId,
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

    async grantTeamOwners(
      teamId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Team,
          object: teamId,
          relation: TeamRelation.Owners,
          subject_set: {
            namespace: subjectNs,
            object: subjectId,
            relation: '',
          },
        },
      });
    },

    async grantTeamManagers(
      teamId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Team,
          object: teamId,
          relation: TeamRelation.Managers,
          subject_set: {
            namespace: subjectNs,
            object: subjectId,
            relation: '',
          },
        },
      });
    },

    async grantTeamMembers(
      teamId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Team,
          object: teamId,
          relation: TeamRelation.Members,
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
          TeamRelation.Owners,
          TeamRelation.Managers,
          TeamRelation.Members,
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

    async grantGroupParent(groupId: string, teamId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Group,
          object: groupId,
          relation: GroupRelation.Parent,
          subject_set: {
            namespace: KetoNamespace.Team,
            object: teamId,
            relation: '',
          },
        },
      });
    },

    async grantGroupMember(
      groupId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Group,
          object: groupId,
          relation: GroupRelation.Members,
          subject_set: {
            namespace: subjectNs,
            object: subjectId,
            relation: '',
          },
        },
      });
    },

    async removeGroupMember(
      groupId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.Group,
        object: groupId,
        relation: GroupRelation.Members,
        subjectSetNamespace: subjectNs,
        subjectSetObject: subjectId,
        subjectSetRelation: '',
      });
    },

    async removeGroupRelations(groupId: string): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.Group,
        object: groupId,
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
