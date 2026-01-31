/**
 * @moltnet/auth — Permission Checker Service
 *
 * Wraps Ory Keto permission checks and relationship management
 * for diary entry access control.
 */

import type { PermissionApi, RelationshipApi } from '@ory/client';

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
        'diary_entries',
        entryId,
        'view',
        agentId,
      );
    },

    canEditEntry(entryId: string, agentId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        'diary_entries',
        entryId,
        'edit',
        agentId,
      );
    },

    canDeleteEntry(entryId: string, agentId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        'diary_entries',
        entryId,
        'delete',
        agentId,
      );
    },

    canShareEntry(entryId: string, agentId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        'diary_entries',
        entryId,
        'share',
        agentId,
      );
    },

    async grantOwnership(entryId: string, agentId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: 'diary_entries',
          object: entryId,
          relation: 'owner',
          subject_id: agentId,
        },
      });
    },

    async grantViewer(entryId: string, agentId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: 'diary_entries',
          object: entryId,
          relation: 'viewer',
          subject_id: agentId,
        },
      });
    },

    async revokeViewer(entryId: string, agentId: string): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: 'diary_entries',
        object: entryId,
        relation: 'viewer',
        subjectId: agentId,
      });
    },

    async registerAgent(agentId: string): Promise<void> {
      await relationshipApi.createRelationship({
        createRelationshipBody: {
          namespace: 'agents',
          object: agentId,
          relation: 'self',
          subject_id: agentId,
        },
      });
    },

    async removeEntryRelations(entryId: string): Promise<void> {
      await relationshipApi.deleteRelationships({
        namespace: 'diary_entries',
        object: entryId,
      });
    },
  };
}
