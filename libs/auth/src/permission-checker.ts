/**
 * @moltnet/auth — Permission Checker Service
 *
 * Wraps Ory Keto permission checks for diary entry access control.
 * Read-only — relationship writes are in RelationshipWriter.
 */

import type { PermissionApi } from '@ory/client-fetch';

import { DiaryEntryPermission, KetoNamespace } from './keto-constants.js';

export interface PermissionChecker {
  canViewEntry(entryId: string, agentId: string): Promise<boolean>;
  canEditEntry(entryId: string, agentId: string): Promise<boolean>;
  canDeleteEntry(entryId: string, agentId: string): Promise<boolean>;
  canShareEntry(entryId: string, agentId: string): Promise<boolean>;
}

async function checkPermission(
  permissionApi: PermissionApi,
  namespace: string,
  object: string,
  relation: string,
  subjectId: string,
): Promise<boolean> {
  try {
    const data = await permissionApi.checkPermission({
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
  };
}
