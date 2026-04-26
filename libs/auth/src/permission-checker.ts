/**
 * @moltnet/auth — Permission Checker Service
 *
 * Wraps Ory Keto permission checks for resource access control.
 * All checks use subject_set (Agent or Human namespace) so that
 * team traversal works correctly through the OPL.
 * Read-only — relationship writes are in RelationshipWriter.
 */

import type { PermissionApi } from '@ory/client-fetch';
import type { Logger } from 'pino';
import { pino } from 'pino';

import {
  ContextPackPermission,
  DiaryEntryPermission,
  DiaryPermission,
  KetoNamespace,
  TaskPermission,
  TeamPermission,
} from './keto-constants.js';

export interface PermissionChecker {
  canReadDiary(
    diaryId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canWriteDiary(
    diaryId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canManageDiary(
    diaryId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canViewEntry(
    entryId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canEditEntry(
    entryId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canDeleteEntry(
    entryId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canEditAnyEntry(
    entryIds: string[],
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canReadPack(
    packId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canReadPacks(
    packIds: string[],
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<Map<string, boolean>>;
  canManagePack(
    packId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canVerifyClaimPack(
    packId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canAccessTeam(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canWriteTeam(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canManageTeam(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canManageTeamMembers(
    teamId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canViewTask(
    taskId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canImposeTask(
    diaryId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canClaimTask(
    taskId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canCancelTask(
    taskId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
  canReportTask(
    taskId: string,
    subjectId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
}

async function checkPermission(
  permissionApi: PermissionApi,
  namespace: string,
  object: string,
  relation: string,
  subjectNs: string,
  subjectId: string,
  logger: Logger,
): Promise<boolean> {
  try {
    const data = await permissionApi.checkPermission({
      namespace,
      object,
      relation,
      subjectId: undefined,
      subjectSetNamespace: subjectNs,
      subjectSetObject: subjectId,
      subjectSetRelation: '',
    });
    if (!data.allowed) {
      logger.debug(
        { namespace, object, relation, subjectNs, subjectId },
        'keto.permission_denied',
      );
    }
    return data.allowed;
  } catch (err) {
    // Previously this catch silently returned false — a transient Keto
    // blip then surfaced as a 403 to the caller. Log it so flakes are
    // visible; keep deny-on-error semantics (failing open is worse).
    logger.warn(
      { err, namespace, object, relation, subjectNs, subjectId },
      'keto.permission_check_failed',
    );
    return false;
  }
}

async function batchCheckPermissions(
  permissionApi: PermissionApi,
  tuples: Array<{
    namespace: string;
    object: string;
    relation: string;
    subject_set: {
      namespace: string;
      object: string;
      relation: string;
    };
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
  logger: Logger = pino({ name: 'permission-checker' }),
): PermissionChecker {
  const log = logger.child({ component: 'permission-checker' });
  return {
    canReadDiary(
      diaryId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Diary,
        diaryId,
        DiaryPermission.Read,
        subjectNs,
        subjectId,
        log,
      );
    },

    canWriteDiary(
      diaryId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Diary,
        diaryId,
        DiaryPermission.Write,
        subjectNs,
        subjectId,
        log,
      );
    },

    canManageDiary(
      diaryId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Diary,
        diaryId,
        DiaryPermission.Manage,
        subjectNs,
        subjectId,
        log,
      );
    },

    canViewEntry(
      entryId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.DiaryEntry,
        entryId,
        DiaryEntryPermission.View,
        subjectNs,
        subjectId,
        log,
      );
    },

    canEditEntry(
      entryId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.DiaryEntry,
        entryId,
        DiaryEntryPermission.Edit,
        subjectNs,
        subjectId,
        log,
      );
    },

    canDeleteEntry(
      entryId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.DiaryEntry,
        entryId,
        DiaryEntryPermission.Delete,
        subjectNs,
        subjectId,
        log,
      );
    },

    async canEditAnyEntry(
      entryIds: string[],
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      if (entryIds.length === 0) return false;
      const results = await batchCheckPermissions(
        permissionApi,
        entryIds.map((entryId) => ({
          namespace: KetoNamespace.DiaryEntry,
          object: entryId,
          relation: DiaryEntryPermission.Edit,
          subject_set: {
            namespace: subjectNs,
            object: subjectId,
            relation: '',
          },
        })),
      );
      return results.some((r) => r);
    },

    canReadPack(
      packId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.ContextPack,
        packId,
        ContextPackPermission.Read,
        subjectNs,
        subjectId,
        log,
      );
    },

    async canReadPacks(
      packIds: string[],
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<Map<string, boolean>> {
      const results = await batchCheckPermissions(
        permissionApi,
        packIds.map((packId) => ({
          namespace: KetoNamespace.ContextPack,
          object: packId,
          relation: ContextPackPermission.Read,
          subject_set: {
            namespace: subjectNs,
            object: subjectId,
            relation: '',
          },
        })),
      );

      return new Map(
        packIds.map((packId, index) => [packId, results[index] ?? false]),
      );
    },

    canManagePack(
      packId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.ContextPack,
        packId,
        ContextPackPermission.Manage,
        subjectNs,
        subjectId,
        log,
      );
    },
    canVerifyClaimPack(
      packId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.ContextPack,
        packId,
        ContextPackPermission.VerifyClaim,
        subjectNs,
        subjectId,
        log,
      );
    },

    canAccessTeam(
      teamId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Team,
        teamId,
        TeamPermission.Access,
        subjectNs,
        subjectId,
        log,
      );
    },

    canWriteTeam(
      teamId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Team,
        teamId,
        TeamPermission.Write,
        subjectNs,
        subjectId,
        log,
      );
    },

    canManageTeam(
      teamId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Team,
        teamId,
        TeamPermission.Manage,
        subjectNs,
        subjectId,
        log,
      );
    },

    canManageTeamMembers(
      teamId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Team,
        teamId,
        TeamPermission.ManageMembers,
        subjectNs,
        subjectId,
        log,
      );
    },

    canViewTask(
      taskId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Task,
        taskId,
        TaskPermission.View,
        subjectNs,
        subjectId,
        log,
      );
    },

    canImposeTask(
      diaryId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Diary,
        diaryId,
        DiaryPermission.Write,
        subjectNs,
        subjectId,
        log,
      );
    },

    canClaimTask(
      taskId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Task,
        taskId,
        TaskPermission.Claim,
        subjectNs,
        subjectId,
        log,
      );
    },

    canCancelTask(
      taskId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Task,
        taskId,
        TaskPermission.Cancel,
        subjectNs,
        subjectId,
        log,
      );
    },

    canReportTask(
      taskId: string,
      subjectId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      return checkPermission(
        permissionApi,
        KetoNamespace.Task,
        taskId,
        TaskPermission.Report,
        subjectNs,
        subjectId,
        log,
      );
    },
  };
}
