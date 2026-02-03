/**
 * @moltnet/auth — Permission Checker Service
 *
 * Wraps Ory Keto permission checks and relationship management
 * for diary entry access control.
 */

import type { PermissionApi, RelationshipApi } from '@ory/client';

import {
  AgentRelation,
  DiaryEntryPermission,
  DiaryEntryRelation,
  KetoNamespace,
} from './keto-constants.js';

export interface PermissionChecker {
  canViewEntry(entryId: string, agentId: string): Promise<boolean>;
  canEditEntry(entryId: string, agentId: string): Promise<boolean>;
  canDeleteEntry(entryId: string, agentId: string): Promise<boolean>;
  canShareEntry(entryId: string, agentId: string): Promise<boolean>;
  grantOwnership(entryId: string, agentId: string): Promise<void>;
  grantViewer(entryId: string, agentId: string): Promise<void>;
  revokeViewer(entryId: string, agentId: string): Promise<void>;
  registerAgent(agentId: string): Promise<void>;
  removeEntryRelations(entryId: string): Promise<void>;
}

async function checkPermission(
  permissionApi: PermissionApi,
  namespace: string,
  object: string,
  relation: string,
  subjectId: string,
): Promise<boolean> {
  try {
    const { data } = await permissionApi.checkPermission({
      namespace,
      object,
      relation,
      subjectId,
    });
    return data.allowed;
  } catch {
    return false;
  }
}

export function createPermissionChecker(
  permissionApi: PermissionApi,
  relationshipApi: RelationshipApi,
): PermissionChecker {
  return {
    canViewEntry(entryId: string, agentId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.DiaryEntry,
        entryId,
        DiaryEntryPermission.View,
        agentId,
      );
    },

    canEditEntry(entryId: string, agentId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.DiaryEntry,
        entryId,
        DiaryEntryPermission.Edit,
        agentId,
      );
    },

    canDeleteEntry(entryId: string, agentId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.DiaryEntry,
        entryId,
        DiaryEntryPermission.Delete,
        agentId,
      );
    },

    canShareEntry(entryId: string, agentId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.DiaryEntry,
        entryId,
        DiaryEntryPermission.Share,
        agentId,
      );
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

    async revokeViewer(entryId: string, agentId: string): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: KetoNamespace.DiaryEntry,
        object: entryId,
        relation: DiaryEntryRelation.Viewer,
        subjectId: agentId,
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
