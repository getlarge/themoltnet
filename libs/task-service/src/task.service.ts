import { KetoNamespace } from '@moltnet/auth';
import { computeJsonCid } from '@moltnet/crypto-service';
import {
  DBOS,
  type NewTaskMessage,
  type Task as DbTask,
} from '@moltnet/database';
import {
  enqueueTaskAttemptWorkflow,
  type TaskAttemptFinalEvent,
} from '@moltnet/task-workflows';
import {
  type DaemonState,
  type Task,
  type TaskAttempt,
  type TaskError,
  type TaskUsage,
  validateTaskOutput,
} from '@moltnet/tasks';

import {
  persistExecutorVerification,
  verifyExecutorForPhase,
} from './executor-attestation.js';
import { createTaskConditionHelpers } from './task-conditions.js';
import { createTaskCreateService } from './task-create.service.js';
import { createTaskDeleteService } from './task-delete.service.js';
import { createTaskQueryService } from './task-query.service.js';
import {
  assertActiveTaskLease,
  ATTEMPT_TERMINAL_STATUSES,
  DEFAULT_LEASE_TTL_SEC,
  EVENT_TIMEOUT_SECONDS,
  TaskServiceError,
  taskWorkflowId,
  TERMINAL_STATUSES,
} from './task-service.shared.js';
import type {
  ExecutorAttestationInput,
  TaskServiceDeps,
} from './task-service.types.js';
import { createAsyncValidationContextFactory } from './task-validation-context.js';
import { dbAttemptToWire, dbTaskToWire } from './wire-mappers.js';

export function createTaskService(deps: TaskServiceDeps) {
  const {
    taskRepository,
    agentRepository,
    runtimeProfileRepository,
    permissionChecker,
    relationshipWriter,
    transactionRunner,
    enqueueWorkflowInCurrentTransaction,
    logger,
  } = deps;
  if (typeof enqueueWorkflowInCurrentTransaction !== 'function') {
    throw new Error(
      'createTaskService requires enqueueWorkflowInCurrentTransaction to preserve transactional task claim enqueue semantics',
    );
  }
  const makeAsyncValidationContext = createAsyncValidationContextFactory(deps);
  const conditionHelpers = createTaskConditionHelpers(
    deps,
    makeAsyncValidationContext,
  );

  async function waitForAttemptFinalTask(
    workflowId: string,
    taskId: string,
    attemptN: number,
    timeoutMessage: string,
  ): Promise<{ final: TaskAttemptFinalEvent; task: DbTask }> {
    const final = await DBOS.getEvent<TaskAttemptFinalEvent>(
      workflowId,
      'result',
      EVENT_TIMEOUT_SECONDS,
    );
    if (!final) {
      throw new TaskServiceError('timed_out', timeoutMessage);
    }
    if (final.taskId !== taskId || final.attemptN !== attemptN) {
      logger.error(
        {
          taskId,
          attemptN,
          workflowId,
          finalTaskId: final.taskId,
          finalAttemptN: final.attemptN,
          finalStatus: final.status,
        },
        'task.workflow.result_mismatch',
      );
      throw new TaskServiceError(
        'conflict',
        'Task workflow result did not match the requested attempt',
      );
    }

    const updated = await taskRepository.findById(taskId);
    if (!updated) {
      throw new TaskServiceError(
        'not_found',
        'Task could not be reloaded after workflow result',
      );
    }
    return { final, task: updated };
  }

  return {
    ...createTaskCreateService(
      deps,
      conditionHelpers,
      makeAsyncValidationContext,
    ),

    ...createTaskQueryService(deps),

    async claim(
      taskId: string,
      callerId: string,
      callerNs: KetoNamespace,
      leaseTtlSec = DEFAULT_LEASE_TTL_SEC,
      executorAttestation: ExecutorAttestationInput = {},
    ): Promise<{ task: Task; attempt: TaskAttempt }> {
      // Only agents may claim tasks (Issue 4).
      if (callerNs !== KetoNamespace.Agent) {
        throw new TaskServiceError('invalid', 'Only agents may claim tasks');
      }

      const initialRow = await taskRepository.findById(taskId);
      if (initialRow?.status === 'waiting') {
        const canClaimWaiting = await permissionChecker.canClaimTask(
          taskId,
          callerId,
          callerNs,
        );
        if (!canClaimWaiting)
          throw new TaskServiceError(
            'forbidden',
            'Not authorized to claim this task',
          );
      }
      let row =
        initialRow?.status === 'waiting'
          ? await conditionHelpers.promoteWaitingTaskIfSatisfied(initialRow)
          : initialRow;
      if (row) {
        row = await conditionHelpers.expireIfLifetimeElapsed(row);
        if (TERMINAL_STATUSES.has(row.status)) {
          throw new TaskServiceError(
            'conflict',
            `Task is already in terminal state: ${row.status}`,
          );
        }
      }
      if (!row || row.status !== 'queued') {
        throw new TaskServiceError(
          'conflict',
          'Task is not queued or is already being claimed',
        );
      }

      const attemptCount = await taskRepository.countAttempts(taskId);
      if (attemptCount >= row.maxAttempts) {
        throw new TaskServiceError(
          'conflict',
          'Task has exhausted all allowed attempts',
        );
      }

      const canClaim = await permissionChecker.canClaimTask(
        taskId,
        callerId,
        callerNs,
      );
      if (!canClaim)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to claim this task',
        );

      const allowedProfiles = (row.allowedProfiles ?? []) as {
        profileId: string;
      }[];
      const selectedProfileId = executorAttestation.profileId;
      if (selectedProfileId) {
        const selectedProfile =
          await runtimeProfileRepository.findById(selectedProfileId);
        if (!selectedProfile || selectedProfile.teamId !== row.teamId) {
          throw new TaskServiceError(
            'forbidden',
            'Runtime profile does not resolve in the task team',
          );
        }
      }
      if (allowedProfiles.length > 0) {
        if (
          !selectedProfileId ||
          !allowedProfiles.some((p) => p.profileId === selectedProfileId)
        ) {
          throw new TaskServiceError(
            'forbidden',
            'Task requires an allowed runtime profile',
          );
        }
      }

      const attemptN = attemptCount + 1;
      const workflowId = taskWorkflowId(taskId, attemptN);
      const claimedExecutor = await verifyExecutorForPhase({
        phase: 'claim',
        task: row,
        callerId,
        attemptN: null,
        outputCid: null,
        attestation: executorAttestation,
        taskRepository,
        agentRepository,
      });

      // CAS update: atomically move status from 'queued' → 'dispatched' (Issue 1).
      // For freeform continuations (#1287), serialise concurrent claim
      // attempts that target the same parent attempt with a non-blocking
      // advisory lock. If the lock is already held by another daemon, we
      // signal `conflict` so the task remains queued for the next poll
      // cycle instead of having two daemons race past `claimIfQueued`
      // (which races even though it's a CAS, because the race is at the
      // *parent attempt* level — two different queued continuations of
      // the same parent could otherwise both win).
      const continueFrom = (
        row.input as
          | { continueFrom?: { taskId: string; attemptN: number } }
          | null
          | undefined
      )?.continueFrom;
      const claimedRow = await transactionRunner.runInTransaction(
        async () => {
          if (continueFrom) {
            const acquired = await taskRepository.tryAcquireContinuationLock(
              continueFrom.taskId,
              continueFrom.attemptN,
            );
            if (!acquired) {
              throw new TaskServiceError(
                'conflict',
                'Another daemon is claiming a continuation of the same parent attempt; leaving task queued',
              );
            }
          }
          const claimed = await taskRepository.claimIfQueued(taskId);
          if (!claimed) return null;

          await persistExecutorVerification(claimedExecutor, taskRepository);
          await enqueueTaskAttemptWorkflow(
            enqueueWorkflowInCurrentTransaction,
            {
              taskId,
              attemptN,
              callerId,
              workflowId,
              leaseTtlSec,
              claimedExecutorFingerprint: claimedExecutor?.fingerprint ?? null,
              dispatchTimeoutSec: row.dispatchTimeoutSec ?? null,
              runningTimeoutSec: row.runningTimeoutSec ?? null,
            },
          );

          return claimed;
        },
        { name: 'task.claim.cas' },
      );
      if (!claimedRow) {
        throw new TaskServiceError(
          'conflict',
          'Task is not queued or is already being claimed',
        );
      }
      const claimed = await DBOS.getEvent<{ taskId: string; attemptN: number }>(
        workflowId,
        'claimed',
        EVENT_TIMEOUT_SECONDS,
      );
      if (!claimed) {
        throw new TaskServiceError('timed_out', 'Claim workflow timed out');
      }

      await relationshipWriter.grantTaskClaimant(taskId, callerId);

      const [updatedTask, attempt] = await Promise.all([
        taskRepository.findById(taskId),
        taskRepository.findAttemptWithManifests(taskId, attemptN),
      ]);

      if (!updatedTask || !attempt) {
        throw new TaskServiceError(
          'not_found',
          'Claimed task or attempt could not be reloaded',
        );
      }

      logger.info({ taskId, attemptN, callerId }, 'task.claimed');
      return {
        task: dbTaskToWire(updatedTask),
        attempt: dbAttemptToWire(attempt),
      };
    },

    async heartbeat(
      taskId: string,
      attemptN: number,
      callerId: string,
      callerNs: KetoNamespace,
      leaseTtlSec = DEFAULT_LEASE_TTL_SEC,
    ): Promise<{
      claimExpiresAt: string;
      cancelled: boolean;
      cancelReason: string | null;
    }> {
      const task = await taskRepository.findById(taskId);
      if (!task) throw new TaskServiceError('not_found', 'Task not found');

      const attempt = await taskRepository.findAttempt(taskId, attemptN);
      if (!attempt)
        throw new TaskServiceError('not_found', 'Attempt not found');
      if (attempt.claimedByAgentId !== callerId) {
        throw new TaskServiceError(
          'forbidden',
          'Only the claiming agent may send heartbeats',
        );
      }

      // Cancellation is reported via the response, not as 409 — the
      // runtime needs a clean signal to abort the executor without
      // having to interpret an error envelope (#938). Other terminal
      // states (completed / failed / expired) remain 409 because there
      // is no executor to abort and a heartbeat against them is a
      // contract violation.
      if (task.status === 'cancelled') {
        logger.debug({ taskId, attemptN }, 'task.heartbeat.on_cancelled_task');
        return {
          claimExpiresAt:
            attempt.completedAt?.toISOString() ?? new Date().toISOString(),
          cancelled: true,
          cancelReason: task.cancelReason ?? null,
        };
      }
      if (TERMINAL_STATUSES.has(task.status)) {
        throw new TaskServiceError(
          'conflict',
          `Task is already in terminal state: ${task.status}`,
        );
      }
      assertActiveTaskLease(
        task,
        callerId,
        'Only the active claiming agent may send heartbeats',
      );

      const workflowId = taskWorkflowId(taskId, attemptN);
      // Multiplexed `progress` topic (#936): the workflow's running-phase
      // recv loop dispatches on `kind`. First heartbeat is `started`
      // (transitions claimed→running); subsequent ones are `heartbeat`
      // and refresh the sliding lease window inside the loop without
      // accumulating orphaned events.
      const isFirstHeartbeat = attempt.status === 'claimed';
      const progressKind: 'started' | 'heartbeat' = isFirstHeartbeat
        ? 'started'
        : 'heartbeat';
      await DBOS.send(
        workflowId,
        { kind: progressKind, leaseTtlSec },
        'progress',
      );

      const claimExpiresAt = new Date(Date.now() + leaseTtlSec * 1000);
      // Conditional update: never clobber a terminal status (most importantly
      // `cancelled`) back to `running`. A cancel can commit between this
      // heartbeat's earlier task.findById and the write below; without the
      // exclusion the heartbeat would silently un-cancel the task (#938).
      const updated = await taskRepository.updateStatusIfNotIn(
        taskId,
        'running',
        ['completed', 'failed', 'cancelled', 'expired'],
        { claimExpiresAt },
      );
      if (!updated) {
        // Lost the race — re-read and report cancellation cleanly. Other
        // terminal states bubble up as 409 (the worker can't keep working
        // on a completed/failed/expired task).
        const fresh = await taskRepository.findById(taskId);
        if (fresh && fresh.status === 'cancelled') {
          logger.debug(
            { taskId, attemptN },
            'task.heartbeat.race_lost_to_cancel',
          );
          return {
            claimExpiresAt:
              attempt.completedAt?.toISOString() ?? new Date().toISOString(),
            cancelled: true,
            cancelReason: fresh.cancelReason ?? null,
          };
        }
        throw new TaskServiceError(
          'conflict',
          `Task is already in terminal state: ${fresh?.status ?? 'unknown'}`,
        );
      }
      // Synchronously stamp attempt.status = 'running' on the first
      // heartbeat. The workflow's markRunning tx will also set this
      // (idempotent overwrite) but writing it here closes a race: the
      // worker's next /complete or /fail call expects attempt.status
      // !== 'claimed' (otherwise the 409 heartbeat-required guard
      // fires). Without this row write, a fast worker can call
      // /complete before the workflow's recv→tx round-trip lands.
      if (isFirstHeartbeat) {
        await taskRepository.updateAttempt(taskId, attemptN, {
          status: 'running',
          startedAt: new Date(),
        });
      }

      logger.debug({ taskId, attemptN }, 'task.heartbeat');
      return {
        claimExpiresAt: claimExpiresAt.toISOString(),
        cancelled: false,
        cancelReason: null,
      };
    },

    async complete(
      taskId: string,
      attemptN: number,
      callerId: string,
      callerNs: KetoNamespace,
      body: {
        output: Record<string, unknown>;
        outputCid: string;
        usage: TaskUsage;
        contentSignature?: string;
        executorManifest?: Record<string, unknown>;
        executorFingerprint?: string;
        executorSignature?: string;
        daemonState?: DaemonState | null;
      },
    ): Promise<Task> {
      const task = await taskRepository.findById(taskId);
      if (!task) throw new TaskServiceError('not_found', 'Task not found');
      if (TERMINAL_STATUSES.has(task.status)) {
        // Defense in depth (#938): a /complete that races with a /cancel
        // must not be able to overwrite the cancelled status. Without
        // this guard the workflow would persist 'completed' on top of
        // 'cancelled', silently undoing the cancellation.
        throw new TaskServiceError(
          'conflict',
          `Task is already in terminal state: ${task.status}`,
        );
      }

      const attempt = await taskRepository.findAttempt(taskId, attemptN);
      if (!attempt)
        throw new TaskServiceError('not_found', 'Attempt not found');
      if (attempt.claimedByAgentId !== callerId) {
        throw new TaskServiceError(
          'forbidden',
          'Only the claiming agent may complete this attempt',
        );
      }
      assertActiveTaskLease(
        task,
        callerId,
        'Only the active claiming agent may complete this attempt',
      );
      if (attempt.status === 'claimed') {
        // The DBOS workflow blocks on recv('started') before it will accept
        // a result. Without a prior /heartbeat the workflow has not crossed
        // claimed → running, so sending the result here would deadlock the
        // HTTP handler waiting for terminal status. Reject fast with a
        // diagnosable error instead.
        throw new TaskServiceError(
          'conflict',
          'Cannot complete an attempt that has not been started; call /heartbeat first',
        );
      }
      if (ATTEMPT_TERMINAL_STATUSES.has(attempt.status)) {
        // The attempt already settled (e.g. aborted on daemon shutdown,
        // then the task requeued). A late /complete from this abandoned
        // attempt must not revive or overwrite the task (#1382).
        throw new TaskServiceError(
          'conflict',
          `Attempt ${attemptN} is already in terminal state: ${attempt.status}`,
        );
      }

      // Pass `task.input` so per-type validators can run cross-field
      // rules (e.g. "verification is required when input.successCriteria
      // is set" on fulfillment task types).
      const outputErrors = validateTaskOutput(
        task.taskType,
        body.output,
        task.input,
      );
      if (outputErrors.length > 0) {
        throw new TaskServiceError(
          'invalid',
          `Task output failed validation for task type: ${task.taskType}`,
          outputErrors,
        );
      }

      const computedOutputCid = await computeJsonCid(body.output);
      if (computedOutputCid !== body.outputCid) {
        throw new TaskServiceError(
          'invalid',
          'outputCid does not match the canonical CID of output',
          [
            {
              field: 'outputCid',
              message: `Expected ${computedOutputCid} for the supplied output`,
            },
          ],
        );
      }
      const completedExecutor = await verifyExecutorForPhase({
        phase: 'complete',
        task,
        callerId,
        attemptN,
        outputCid: body.outputCid,
        attestation: body,
        taskRepository,
        agentRepository,
      });
      await persistExecutorVerification(completedExecutor, taskRepository);

      const workflowId = taskWorkflowId(taskId, attemptN);
      // Multiplexed `progress` topic (#936).
      await DBOS.send(
        workflowId,
        {
          kind: 'completed',
          output: body.output,
          outputCid: body.outputCid,
          usage: body.usage,
          completedExecutorFingerprint: completedExecutor?.fingerprint ?? null,
          daemonState: body.daemonState ?? null,
        },
        'progress',
      );

      const { final, task: updated } = await waitForAttemptFinalTask(
        workflowId,
        taskId,
        attemptN,
        'Complete workflow timed out waiting for result',
      );
      // Defense in depth (#938): if the workflow ended up in a different
      // terminal state than the one this caller asked for, return 409
      // rather than 200. This handles the race where /cancel and
      // /complete are sent in the same window and DBOS processes the
      // cancel event first — the task ends up `cancelled`, and the
      // worker's /complete request did not actually succeed.
      if (final.status !== 'completed' || updated.status !== 'completed') {
        logger.info(
          {
            taskId,
            attemptN,
            finalStatus: final.status,
            status: updated.status,
          },
          'task.complete.race_lost',
        );
        throw new TaskServiceError(
          'conflict',
          `Task ended in terminal state ${updated.status}, not completed`,
        );
      }
      logger.info(
        { taskId, attemptN, status: updated.status },
        'task.completed',
      );
      await conditionHelpers.tryPromoteSatisfiedWaitingTasks({
        triggerTaskId: taskId,
      });
      return dbTaskToWire(updated);
    },

    async failAttempt(
      taskId: string,
      attemptN: number,
      callerId: string,
      callerNs: KetoNamespace,
      error: TaskError,
    ): Promise<Task> {
      const task = await taskRepository.findById(taskId);
      if (!task) throw new TaskServiceError('not_found', 'Task not found');
      if (TERMINAL_STATUSES.has(task.status)) {
        // Defense in depth (#938): a /fail that races with a /cancel
        // must not be able to overwrite the cancelled status.
        throw new TaskServiceError(
          'conflict',
          `Task is already in terminal state: ${task.status}`,
        );
      }

      const attempt = await taskRepository.findAttempt(taskId, attemptN);
      if (!attempt)
        throw new TaskServiceError('not_found', 'Attempt not found');
      if (attempt.claimedByAgentId !== callerId) {
        throw new TaskServiceError(
          'forbidden',
          'Only the claiming agent may fail this attempt',
        );
      }
      assertActiveTaskLease(
        task,
        callerId,
        'Only the active claiming agent may fail this attempt',
      );
      if (attempt.status === 'claimed') {
        throw new TaskServiceError(
          'conflict',
          'Cannot fail an attempt that has not been started; call /heartbeat first',
        );
      }
      if (ATTEMPT_TERMINAL_STATUSES.has(attempt.status)) {
        // The attempt already settled (e.g. aborted on daemon shutdown,
        // then the task requeued). A late /fail from this abandoned
        // attempt must not revive or overwrite the task (#1382).
        throw new TaskServiceError(
          'conflict',
          `Attempt ${attemptN} is already in terminal state: ${attempt.status}`,
        );
      }

      const workflowId = taskWorkflowId(taskId, attemptN);
      // Multiplexed `progress` topic (#936).
      await DBOS.send(workflowId, { kind: 'failed', error }, 'progress');

      const { final, task: updated } = await waitForAttemptFinalTask(
        workflowId,
        taskId,
        attemptN,
        'Fail workflow timed out waiting for result',
      );
      if (final.status !== 'failed') {
        logger.info(
          {
            taskId,
            attemptN,
            finalStatus: final.status,
            status: updated.status,
          },
          'task.fail.race_lost',
        );
        throw new TaskServiceError(
          'conflict',
          `Task workflow ended with ${final.status}, not failed`,
        );
      }
      if (updated.status === 'queued') {
        logger.info(
          { taskId, attemptN, status: updated.status },
          'task.fail.requeued',
        );
        return dbTaskToWire(updated);
      }
      // Defense in depth (#938): if the workflow ended in a different
      // terminal state (typically `cancelled` when a cancel races
      // with a fail), the caller's /fail did not actually take
      // effect — return 409.
      if (updated.status !== 'failed') {
        logger.info(
          { taskId, attemptN, status: updated.status },
          'task.fail.race_lost',
        );
        throw new TaskServiceError(
          'conflict',
          `Task ended in terminal state ${updated.status}, not failed`,
        );
      }
      logger.info({ taskId, attemptN, status: updated.status }, 'task.failed');
      await conditionHelpers.tryPromoteSatisfiedWaitingTasks({
        triggerTaskId: taskId,
      });
      return dbTaskToWire(updated);
    },

    async abort(
      taskId: string,
      attemptN: number,
      callerId: string,
      callerNs: KetoNamespace,
      reason?: string,
    ): Promise<Task> {
      // Attempt-level abort (#1382): the active claimant intentionally
      // abandons this attempt (e.g. daemon SIGINT/SIGTERM) without
      // cancelling the whole task. The task requeues for another claim
      // when retry policy allows, or settles `failed` when exhausted.
      const task = await taskRepository.findById(taskId);
      if (!task) throw new TaskServiceError('not_found', 'Task not found');
      if (TERMINAL_STATUSES.has(task.status)) {
        throw new TaskServiceError(
          'conflict',
          `Task is already in terminal state: ${task.status}`,
        );
      }

      const attempt = await taskRepository.findAttempt(taskId, attemptN);
      if (!attempt)
        throw new TaskServiceError('not_found', 'Attempt not found');
      // Stricter than /cancel: only the active claimant may abort its own
      // attempt. A non-claimant abort would be a denial primitive.
      if (attempt.claimedByAgentId !== callerId) {
        throw new TaskServiceError(
          'forbidden',
          'Only the claiming agent may abort this attempt',
        );
      }
      assertActiveTaskLease(
        task,
        callerId,
        'Only the active claiming agent may abort this attempt',
      );
      if (attempt.status === 'claimed') {
        throw new TaskServiceError(
          'conflict',
          'Cannot abort an attempt that has not been started; call /heartbeat first',
        );
      }
      if (ATTEMPT_TERMINAL_STATUSES.has(attempt.status)) {
        throw new TaskServiceError(
          'conflict',
          `Attempt ${attemptN} is already in terminal state: ${attempt.status}`,
        );
      }

      const workflowId = taskWorkflowId(taskId, attemptN);
      const error = {
        code: 'worker_aborted',
        message: reason ?? 'attempt aborted by claimant',
      };
      // Multiplexed `progress` topic (#936).
      await DBOS.send(workflowId, { kind: 'aborted', error }, 'progress');

      const { final, task: updated } = await waitForAttemptFinalTask(
        workflowId,
        taskId,
        attemptN,
        'Abort workflow timed out waiting for result',
      );
      // Success when the workflow requeued the task (non-terminal
      // `queued`, the expected outcome with retries remaining) OR settled
      // it terminally (`failed` when exhausted, or a raced `cancelled`).
      if (final.status !== 'aborted' && final.status !== 'cancelled') {
        logger.info(
          {
            taskId,
            attemptN,
            finalStatus: final.status,
            status: updated.status,
          },
          'task.abort.race_lost',
        );
        throw new TaskServiceError(
          'conflict',
          `Task workflow ended with ${final.status}, not aborted`,
        );
      }
      if (
        updated.status !== 'queued' &&
        !TERMINAL_STATUSES.has(updated.status)
      ) {
        throw new TaskServiceError(
          'timed_out',
          'Abort workflow result did not settle the task',
        );
      }
      logger.info({ taskId, attemptN, status: updated.status }, 'task.aborted');
      await conditionHelpers.tryPromoteSatisfiedWaitingTasks({
        triggerTaskId: taskId,
      });
      return dbTaskToWire(updated);
    },

    async cancel(
      taskId: string,
      callerId: string,
      callerNs: KetoNamespace,
      reason: string,
      // Id written to cancelledBy*Id. For humans this must be humans.id, not
      // the Kratos identityId used for Keto checks (see auth-principal.ts).
      // Defaults to callerId to preserve the agent path.
      cancellerId: string = callerId,
    ): Promise<Task> {
      const row = await taskRepository.findById(taskId);
      if (!row) throw new TaskServiceError('not_found', 'Task not found');

      const terminalStatuses: DbTask['status'][] = [
        'completed',
        'failed',
        'cancelled',
        'expired',
      ];
      if (terminalStatuses.includes(row.status)) {
        throw new TaskServiceError(
          'conflict',
          `Cannot cancel a task in terminal state: ${row.status}`,
        );
      }

      const canCancel = await permissionChecker.canCancelTask(
        taskId,
        callerId,
        callerNs,
      );
      if (!canCancel)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to cancel this task',
        );

      const isAgent = callerNs === KetoNamespace.Agent;
      // Clear claim fields together with the status write. The workflow's
      // terminal-persist tx now uses a conditional update that skips
      // already-cancelled rows (#949), so we can't rely on it to clear
      // these. Doing it here also makes the cancel side-effect atomic on
      // the row.
      const updated = await taskRepository.updateStatus(taskId, 'cancelled', {
        cancelReason: reason,
        cancelledByAgentId: isAgent ? cancellerId : null,
        cancelledByHumanId: isAgent ? null : cancellerId,
        claimAgentId: null,
        claimExpiresAt: null,
      });

      // Signal any active workflow so it unblocks and persists the
      // attempt as cancelled. Without this, the workflow sits parked
      // until runningTimeoutSec elapses and the worker keeps burning
      // compute on work that is no longer wanted (#938).
      //
      // With the multiplexed `progress` topic (#936), a single
      // `cancelled` send unblocks the workflow regardless of whether
      // it's parked in the dispatch-phase recv (waiting for the first
      // event) or the running-phase loop. The workflow's dispatch
      // branch handles `cancelled` directly; the running-phase loop
      // falls through to persistTerminalResult.
      //
      // We deliberately do NOT remove the Keto claimant tuple here,
      // and the workflow's terminal persist tx for cancel ALSO
      // preserves it (see persistTerminalResult / dispatch-phase first
      // event handler in task-workflows.ts — `if (evt.kind !==
      // 'cancelled') removeClaimantTupleStep(...)`). The claimer
      // needs to keep the `report` permit so its next /heartbeat can
      // pass `canReportTask` and observe `cancelled: true` to drive
      // executor abort. Orphan-recovery sweeper (#937) cleans up later.
      const attempts = await taskRepository.listAttempts(taskId);
      const active = attempts.find(
        (a) => a.status === 'claimed' || a.status === 'running',
      );
      if (active) {
        const workflowId = taskWorkflowId(taskId, active.attemptN);
        // The workflow persists `error` to attempt.error, which is
        // serialized via the TaskError schema {code, message, ...}.
        await DBOS.send(
          workflowId,
          {
            kind: 'cancelled',
            error: {
              code: 'task_cancelled',
              message: reason,
              retryable: false,
            },
          },
          'progress',
        );
      }

      if (!updated) {
        throw new TaskServiceError('not_found', 'Task not found');
      }

      logger.info({ taskId, callerId, reason }, 'task.cancelled');
      await conditionHelpers.tryPromoteSatisfiedWaitingTasks({
        triggerTaskId: taskId,
      });
      return dbTaskToWire(updated);
    },

    ...createTaskDeleteService(deps),

    async appendMessages(
      taskId: string,
      attemptN: number,
      callerId: string,
      callerNs: KetoNamespace,
      messages: Array<{
        kind: string;
        payload: Record<string, unknown>;
        timestamp?: string;
      }>,
    ): Promise<{ count: number }> {
      const task = await taskRepository.findById(taskId);
      if (!task) throw new TaskServiceError('not_found', 'Task not found');
      if (TERMINAL_STATUSES.has(task.status)) {
        throw new TaskServiceError(
          'conflict',
          `Task is already in terminal state: ${task.status}`,
        );
      }
      assertActiveTaskLease(
        task,
        callerId,
        'Only the active claiming agent may append messages',
      );

      const attempt = await taskRepository.findAttempt(taskId, attemptN);
      if (!attempt)
        throw new TaskServiceError('not_found', 'Attempt not found');
      if (attempt.claimedByAgentId !== callerId) {
        throw new TaskServiceError(
          'forbidden',
          'Only the claiming agent may append messages',
        );
      }
      if (ATTEMPT_TERMINAL_STATUSES.has(attempt.status)) {
        throw new TaskServiceError(
          'conflict',
          `Attempt ${attemptN} is already in terminal state: ${attempt.status}`,
        );
      }

      // Seq is generated atomically inside the DB by the repository to avoid
      // read-then-write races (see appendMessages in task.repository.ts).
      const rows = messages.map((m) => ({
        taskId,
        attemptN,
        timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
        kind: m.kind as NewTaskMessage['kind'],
        payload: m.payload,
      }));

      await taskRepository.appendMessages(rows);
      logger.debug(
        { taskId, attemptN, count: messages.length },
        'task.messages_appended',
      );
      return { count: messages.length };
    },

    promoteSatisfiedWaitingTasks: (opts?: { triggerTaskId?: string }) =>
      conditionHelpers.promoteSatisfiedWaitingTasks(opts),
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
export { TaskServiceError } from './task-service.shared.js';
export type { CreateTaskInput, TaskServiceDeps } from './task-service.types.js';
