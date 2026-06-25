import type { KetoNamespace } from '@moltnet/auth';
import type {
  ResolvedRuntimeSlot,
  RuntimeSlot,
  RuntimeWorkspace,
} from '@moltnet/database';
import type {
  BeginRuntimeSlotBody,
  FindLatestRuntimeSlotForAttemptQuery,
  FinishRuntimeSlotBody,
} from '@moltnet/tasks';

import {
  createConflictProblem,
  createProblem,
  createValidationProblem,
} from '../problems/index.js';
import type {
  PermissionChecker,
  RuntimeProfileRepository,
  RuntimeSlotRepository,
  TaskRepository,
} from '../types.js';

export interface RuntimeSlotServiceDeps {
  permissionChecker: PermissionChecker;
  runtimeProfileRepository: RuntimeProfileRepository;
  runtimeSlotRepository: RuntimeSlotRepository;
  taskRepository: TaskRepository;
}

export interface RuntimeSlotSubject {
  identityId: string;
  subjectNs: KetoNamespace;
}

export interface BeginRuntimeSlotInput extends RuntimeSlotSubject {
  body: BeginRuntimeSlotBody;
  teamId: string;
}

export interface FinishRuntimeSlotInput extends RuntimeSlotSubject {
  body: FinishRuntimeSlotBody;
  teamId: string;
}

export interface FindLatestRuntimeSlotInput extends RuntimeSlotSubject {
  query: FindLatestRuntimeSlotForAttemptQuery;
  teamId: string;
}

export function createRuntimeSlotService(deps: RuntimeSlotServiceDeps) {
  return {
    async begin(input: BeginRuntimeSlotInput): Promise<RuntimeSlot> {
      await requireTeamAccess(deps, input);
      await assertTaskAttemptInTeam(deps, {
        attemptN: input.body.lastAttemptN,
        taskId: input.body.lastTaskId,
        teamId: input.teamId,
      });
      await assertProfileInTeam(
        deps,
        input.body.runtimeProfileId,
        input.teamId,
      );
      return deps.runtimeSlotRepository.begin({
        ...input.body,
        teamId: input.teamId,
        sessionDir: input.body.sessionDir ?? null,
        sessionPath: input.body.sessionPath ?? null,
        workspaceId: input.body.workspaceId ?? null,
        worktreeBranch: input.body.worktreeBranch ?? null,
        worktreePath: input.body.worktreePath ?? null,
      });
    },

    async finish(input: FinishRuntimeSlotInput): Promise<RuntimeSlot> {
      await requireTeamAccess(deps, input);
      await assertTaskAttemptInTeam(deps, {
        attemptN: input.body.attemptN,
        taskId: input.body.taskId,
        teamId: input.teamId,
      });
      await assertProfileInTeam(
        deps,
        input.body.runtimeProfileId,
        input.teamId,
      );
      const slot = await deps.runtimeSlotRepository.finish({
        ...input.body,
        teamId: input.teamId,
        sessionPath: input.body.sessionPath ?? null,
      });
      if (!slot) {
        throw createConflictProblem('Runtime slot changed before finish', {
          target: {
            keys: { slotKey: input.body.slotKey },
            resource: 'runtime-slot',
          },
        });
      }
      return slot;
    },

    async findLatest(
      input: FindLatestRuntimeSlotInput,
    ): Promise<ResolvedRuntimeSlot> {
      await requireTeamAccess(deps, input);
      await assertTaskAttemptInTeam(deps, {
        attemptN: input.query.attemptN,
        taskId: input.query.taskId,
        teamId: input.teamId,
      });
      const resolved = await deps.runtimeSlotRepository.findLatestByTaskAttempt(
        input.teamId,
        input.query.taskId,
        input.query.attemptN,
      );
      if (!resolved) throw createProblem('not-found');
      return resolved;
    },
  };
}

export function serializeRuntimeSlot(slot: RuntimeSlot) {
  return {
    id: slot.id,
    teamId: slot.teamId,
    agentName: slot.agentName,
    runtimeProfileId: slot.runtimeProfileId ?? null,
    provider: slot.provider,
    model: slot.model,
    slotKey: slot.slotKey,
    taskType: slot.taskType,
    state: slot.state,
    lastTaskId: slot.lastTaskId,
    lastAttemptN: slot.lastAttemptN,
    sessionDir: slot.sessionDir ?? null,
    sessionPath: slot.sessionPath ?? null,
    workspaceRowId: slot.workspaceRowId ?? null,
    createdAtMs: slot.createdAtMs,
    lastUsedAtMs: slot.lastUsedAtMs,
    expiresAtMs: slot.expiresAtMs,
  };
}

export function serializeRuntimeWorkspace(workspace: RuntimeWorkspace | null) {
  if (!workspace) return null;
  return {
    id: workspace.id,
    teamId: workspace.teamId,
    workspaceId: workspace.workspaceId,
    worktreePath: workspace.worktreePath,
    worktreeBranch: workspace.worktreeBranch ?? null,
    kind: workspace.kind,
    createdAtMs: workspace.createdAtMs,
    lastUsedAtMs: workspace.lastUsedAtMs,
  };
}

export function serializeResolvedRuntimeSlot(resolved: ResolvedRuntimeSlot) {
  return {
    slot: serializeRuntimeSlot(resolved.slot),
    workspace: serializeRuntimeWorkspace(resolved.workspace),
  };
}

async function requireTeamAccess(
  deps: RuntimeSlotServiceDeps,
  input: RuntimeSlotSubject & { teamId: string },
) {
  const canAccess = await deps.permissionChecker.canAccessTeam(
    input.teamId,
    input.identityId,
    input.subjectNs,
  );
  if (!canAccess) throw createProblem('not-found');
}

async function assertTaskInTeam(
  deps: RuntimeSlotServiceDeps,
  input: { taskId: string; teamId: string },
) {
  const task = await deps.taskRepository.findById(input.taskId);
  if (!task || task.teamId !== input.teamId) {
    throw createValidationProblem(
      [
        {
          field: 'taskId',
          message: `Task ${input.taskId} does not resolve in team ${input.teamId}`,
        },
      ],
      'runtime slot task does not resolve in team',
    );
  }
}

async function assertTaskAttemptInTeam(
  deps: RuntimeSlotServiceDeps,
  input: { attemptN: number; taskId: string; teamId: string },
) {
  await assertTaskInTeam(deps, input);
  const attempt = await deps.taskRepository.findAttempt(
    input.taskId,
    input.attemptN,
  );
  if (!attempt) {
    throw createValidationProblem(
      [
        {
          field: 'attemptN',
          message: `Task ${input.taskId} attempt ${input.attemptN} does not exist`,
        },
      ],
      'runtime slot task attempt does not exist',
    );
  }
}

async function assertProfileInTeam(
  deps: RuntimeSlotServiceDeps,
  profileId: string,
  teamId: string,
) {
  const profile = await deps.runtimeProfileRepository.findById(profileId);
  if (!profile || profile.teamId !== teamId) {
    throw createValidationProblem(
      [
        {
          field: 'runtimeProfileId',
          message: `Runtime profile ${profileId} does not resolve in team ${teamId}`,
        },
      ],
      'runtime slot profile does not resolve in team',
    );
  }
}
