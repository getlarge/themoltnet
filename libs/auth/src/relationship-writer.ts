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
  RuntimePolicyRelation,
  RuntimeProfileRelation,
  TaskRelation,
  TeamRelation,
} from './keto-constants.js';

export interface RelationshipWriter {
  // Diary relations
  grantDiaryTeam(diaryId: string, teamId: string): Promise<void>;
  removeDiaryTeam(diaryId: string): Promise<void>;
  removeDiaryRelations(diaryId: string): Promise<void>;
  // Per-diary grants (chunk 3)
  grantDiaryWriters(
    diaryId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
  grantDiaryManagers(
    diaryId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
  revokeDiaryWriter(
    diaryId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
  revokeDiaryManager(
    diaryId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<void>;
  // Entry + pack relations
  grantEntryParent(entryId: string, diaryId: string): Promise<void>;
  grantPackParent(packId: string, diaryId: string): Promise<void>;
  removeEntryRelations(entryId: string): Promise<void>;
  removeEntryRelationsBatch(
    entries: Array<{ id: string; diaryId: string }>,
  ): Promise<void>;
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
  removeTeamRoleRelation(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
    relation: TeamRelation,
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
  // Task relations
  grantTaskParent(taskId: string, diaryId: string): Promise<void>;
  grantTaskClaimant(taskId: string, agentId: string): Promise<void>;
  removeTaskRelations(taskId: string): Promise<void>;
  removeTaskRelationsBatch(
    tasks: Array<{
      id: string;
      diaryId: string | null;
      claimAgentId?: string | null;
    }>,
  ): Promise<void>;
  removeTaskClaimant(taskId: string, agentId: string): Promise<void>;
  // Runtime tool-policy relations
  /**
   * Insert/delete a policy's `team` + `tool` edges in a single Keto patch.
   * No-op when there are no deltas.
   */
  writeRuntimePolicyEdges(
    policyId: string,
    edges: {
      teamId?: string;
      addTools?: readonly string[];
      removeTools?: readonly string[];
      addShellCommands?: readonly string[];
      removeShellCommands?: readonly string[];
    },
  ): Promise<void>;
  /** Removes every tuple owned by a policy object (team, tool, and command edges). */
  removeRuntimePolicyRelations(policyId: string): Promise<void>;
  /**
   * Insert/delete a profile's `policies` bindings in a single Keto patch.
   * No-op when there are no deltas.
   */
  writeRuntimeProfilePolicyEdges(
    profileId: string,
    edges: {
      addPolicyIds?: readonly string[];
      removePolicyIds?: readonly string[];
    },
  ): Promise<void>;
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

    async removeTeamRoleRelation(
      teamId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
      relation: TeamRelation,
    ): Promise<void> {
      await relationshipApi.patchRelationships({
        relationshipPatch: [
          {
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
          },
        ],
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

    async removeEntryRelationsBatch(
      entries: Array<{ id: string; diaryId: string }>,
    ): Promise<void> {
      if (entries.length === 0) return;

      await relationshipApi.patchRelationships({
        relationshipPatch: entries.map((entry) => ({
          action: 'delete' as const,
          relation_tuple: {
            namespace: KetoNamespace.DiaryEntry,
            object: entry.id,
            relation: DiaryEntryRelation.Parent,
            subject_set: {
              namespace: KetoNamespace.Diary,
              object: entry.diaryId,
              relation: '',
            },
          },
        })),
      });
    },

    async grantDiaryWriters(
      diaryId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Diary,
          object: diaryId,
          relation: DiaryRelation.Writers,
          subject_set: {
            namespace: subjectNs,
            object: subjectId,
            relation:
              subjectNs === KetoNamespace.Group ? GroupRelation.Members : '',
          },
        },
      });
    },

    async grantDiaryManagers(
      diaryId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Diary,
          object: diaryId,
          relation: DiaryRelation.Managers,
          subject_set: {
            namespace: subjectNs,
            object: subjectId,
            relation:
              subjectNs === KetoNamespace.Group ? GroupRelation.Members : '',
          },
        },
      });
    },

    async revokeDiaryWriter(
      diaryId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.Diary,
        object: diaryId,
        relation: DiaryRelation.Writers,
        subjectSetNamespace: subjectNs,
        subjectSetObject: subjectId,
        subjectSetRelation:
          subjectNs === KetoNamespace.Group ? GroupRelation.Members : '',
      });
    },

    async revokeDiaryManager(
      diaryId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.Diary,
        object: diaryId,
        relation: DiaryRelation.Managers,
        subjectSetNamespace: subjectNs,
        subjectSetObject: subjectId,
        subjectSetRelation:
          subjectNs === KetoNamespace.Group ? GroupRelation.Members : '',
      });
    },

    async grantTaskParent(taskId: string, diaryId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Task,
          object: taskId,
          relation: TaskRelation.Parent,
          subject_set: {
            namespace: KetoNamespace.Diary,
            object: diaryId,
            relation: '',
          },
        },
      });
    },

    async grantTaskClaimant(taskId: string, agentId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: KetoNamespace.Task,
          object: taskId,
          relation: TaskRelation.Claimant,
          subject_set: {
            namespace: KetoNamespace.Agent,
            object: agentId,
            relation: '',
          },
        },
      });
    },

    async removeTaskRelations(taskId: string): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.Task,
        object: taskId,
      });
    },

    async removeTaskRelationsBatch(
      tasks: Array<{
        id: string;
        diaryId: string | null;
        claimAgentId?: string | null;
      }>,
    ): Promise<void> {
      if (tasks.length === 0) return;

      const relationshipPatch = tasks.flatMap((task) => {
        const patches = [];

        if (task.diaryId) {
          patches.push({
            action: 'delete' as const,
            relation_tuple: {
              namespace: KetoNamespace.Task,
              object: task.id,
              relation: TaskRelation.Parent,
              subject_set: {
                namespace: KetoNamespace.Diary,
                object: task.diaryId,
                relation: '',
              },
            },
          });
        }

        if (task.claimAgentId) {
          patches.push({
            action: 'delete' as const,
            relation_tuple: {
              namespace: KetoNamespace.Task,
              object: task.id,
              relation: TaskRelation.Claimant,
              subject_set: {
                namespace: KetoNamespace.Agent,
                object: task.claimAgentId,
                relation: '',
              },
            },
          });
        }

        return patches;
      });

      if (relationshipPatch.length === 0) return;

      await relationshipApi.patchRelationships({ relationshipPatch });
    },

    async removeTaskClaimant(taskId: string, agentId: string): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.Task,
        object: taskId,
        relation: TaskRelation.Claimant,
        subjectSetNamespace: KetoNamespace.Agent,
        subjectSetObject: agentId,
        subjectSetRelation: '',
      });
    },

    async writeRuntimePolicyEdges(
      policyId: string,
      edges: {
        teamId?: string;
        addTools?: readonly string[];
        removeTools?: readonly string[];
        addShellCommands?: readonly string[];
        removeShellCommands?: readonly string[];
      },
    ): Promise<void> {
      const relationshipPatch = [];
      if (edges.teamId) {
        relationshipPatch.push({
          action: 'insert' as const,
          relation_tuple: {
            namespace: KetoNamespace.RuntimePolicy,
            object: policyId,
            relation: RuntimePolicyRelation.Team,
            subject_set: {
              namespace: KetoNamespace.Team,
              object: edges.teamId,
              relation: '',
            },
          },
        });
      }
      for (const toolName of edges.addTools ?? []) {
        relationshipPatch.push({
          action: 'insert' as const,
          relation_tuple: toolTuple(policyId, toolName),
        });
      }
      for (const toolName of edges.removeTools ?? []) {
        relationshipPatch.push({
          action: 'delete' as const,
          relation_tuple: toolTuple(policyId, toolName),
        });
      }
      for (const commandId of edges.addShellCommands ?? []) {
        relationshipPatch.push({
          action: 'insert' as const,
          relation_tuple: commandTuple(policyId, commandId),
        });
      }
      for (const commandId of edges.removeShellCommands ?? []) {
        relationshipPatch.push({
          action: 'delete' as const,
          relation_tuple: commandTuple(policyId, commandId),
        });
      }
      if (relationshipPatch.length === 0) return;
      await relationshipApi.patchRelationships({ relationshipPatch });
    },

    async removeRuntimePolicyRelations(policyId: string): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.RuntimePolicy,
        object: policyId,
      });
    },

    async writeRuntimeProfilePolicyEdges(
      profileId: string,
      edges: {
        addPolicyIds?: readonly string[];
        removePolicyIds?: readonly string[];
      },
    ): Promise<void> {
      const relationshipPatch = [
        ...(edges.addPolicyIds ?? []).map((policyId) => ({
          action: 'insert' as const,
          relation_tuple: profilePolicyTuple(profileId, policyId),
        })),
        ...(edges.removePolicyIds ?? []).map((policyId) => ({
          action: 'delete' as const,
          relation_tuple: profilePolicyTuple(profileId, policyId),
        })),
      ];
      if (relationshipPatch.length === 0) return;
      await relationshipApi.patchRelationships({ relationshipPatch });
    },
  };
}

function toolTuple(policyId: string, toolName: string) {
  return {
    namespace: KetoNamespace.RuntimePolicy,
    object: policyId,
    relation: RuntimePolicyRelation.Tool,
    subject_set: {
      namespace: KetoNamespace.Tool,
      object: toolName,
      relation: '',
    },
  };
}

function commandTuple(policyId: string, commandId: string) {
  return {
    namespace: KetoNamespace.RuntimePolicy,
    object: policyId,
    relation: RuntimePolicyRelation.Command,
    subject_set: {
      namespace: KetoNamespace.ShellCommand,
      object: commandId,
      relation: '',
    },
  };
}

function profilePolicyTuple(profileId: string, policyId: string) {
  return {
    namespace: KetoNamespace.RuntimeProfile,
    object: profileId,
    relation: RuntimeProfileRelation.Policies,
    subject_set: {
      namespace: KetoNamespace.RuntimePolicy,
      object: policyId,
      relation: '',
    },
  };
}
