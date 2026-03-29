/**
 * @moltnet/auth — Permission Checker Service
 *
 * Wraps Ory Keto permission checks for diary entry access control.
 * Read-only — relationship writes are in RelationshipWriter.
 */

import type { PermissionApi } from '@ory/client-fetch';

import {
  ContextPackPermission,
  DiaryEntryPermission,
  DiaryPermission,
  KetoNamespace,
  TeamPermission,
} from './keto-constants.js';

export interface PermissionChecker {
  canReadDiary(diaryId: string, agentId: string): Promise<boolean>;
  canWriteDiary(diaryId: string, agentId: string): Promise<boolean>;
  canManageDiary(diaryId: string, agentId: string): Promise<boolean>;
  canViewEntry(entryId: string, agentId: string): Promise<boolean>;
  canEditEntry(entryId: string, agentId: string): Promise<boolean>;
  canDeleteEntry(entryId: string, agentId: string): Promise<boolean>;
  canEditAnyEntry(entryIds: string[], agentId: string): Promise<boolean>;
  canReadPack(packId: string, agentId: string): Promise<boolean>;
  canReadPacks(
    packIds: string[],
    agentId: string,
  ): Promise<Map<string, boolean>>;
  canManagePack(packId: string, agentId: string): Promise<boolean>;
  canAccessTeam(teamId: string, subjectId: string): Promise<boolean>;
  canManageTeam(teamId: string, subjectId: string): Promise<boolean>;
  canManageTeamMembers(teamId: string, subjectId: string): Promise<boolean>;
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

async function batchCheckPermissions(
  permissionApi: PermissionApi,
  tuples: Array<{
    namespace: string;
    object: string;
    relation: string;
    subject_id: string;
  }>,
): Promise<boolean[]> {
  if (tuples.length === 0) return [];

  const data = await permissionApi.batchCheckPermission({
    batchCheckPermissionBody: {
      tuples,
    },
  });

  const resultErrors = data.results
    .map((result, index) =>
      result.error
        ? `${tuples[index]?.object ?? index}: ${result.error}`
        : null,
    )
    .filter((error): error is string => error !== null);

  if (resultErrors.length > 0) {
    throw new Error(
      `batch permission check failed for ${resultErrors.join(', ')}`,
    );
  }

  return data.results.map((result) => result.allowed);
}

export function createPermissionChecker(
  permissionApi: PermissionApi,
): PermissionChecker {
  return {
    canReadDiary(diaryId: string, agentId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Diary,
        diaryId,
        DiaryPermission.Read,
        agentId,
      );
    },

    canWriteDiary(diaryId: string, agentId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Diary,
        diaryId,
        DiaryPermission.Write,
        agentId,
      );
    },

    canManageDiary(diaryId: string, agentId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Diary,
        diaryId,
        DiaryPermission.Manage,
        agentId,
      );
    },

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

    async canEditAnyEntry(
      entryIds: string[],
      agentId: string,
    ): Promise<boolean> {
      if (entryIds.length === 0) return false;
      const results = await batchCheckPermissions(
        permissionApi,
        entryIds.map((entryId) => ({
          namespace: KetoNamespace.DiaryEntry,
          object: entryId,
          relation: DiaryEntryPermission.Edit,
          subject_id: agentId,
        })),
      );
      return results.some((r) => r);
    },

    canReadPack(packId: string, agentId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.ContextPack,
        packId,
        ContextPackPermission.Read,
        agentId,
      );
    },

    async canReadPacks(
      packIds: string[],
      agentId: string,
    ): Promise<Map<string, boolean>> {
      const results = await batchCheckPermissions(
        permissionApi,
        packIds.map((packId) => ({
          namespace: KetoNamespace.ContextPack,
          object: packId,
          relation: ContextPackPermission.Read,
          subject_id: agentId,
        })),
      );

      return new Map(
        packIds.map((packId, index) => [packId, results[index] ?? false]),
      );
    },

    canManagePack(packId: string, agentId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.ContextPack,
        packId,
        ContextPackPermission.Manage,
        agentId,
      );
    },

    canAccessTeam(teamId: string, subjectId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Team,
        teamId,
        TeamPermission.Access,
        subjectId,
      );
    },

    canManageTeam(teamId: string, subjectId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Team,
        teamId,
        TeamPermission.Manage,
        subjectId,
      );
    },

    canManageTeamMembers(teamId: string, subjectId: string): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Team,
        teamId,
        TeamPermission.ManageMembers,
        subjectId,
      );
    },
  };
}
