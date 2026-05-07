import {
  evaluateAssertions,
  type SuccessCriteria,
  type Task,
  type TaskOutput,
  type VerificationRecord,
  type VerificationResult,
} from '@moltnet/tasks';
import type { Agent, TasksNamespace } from '@themoltnet/sdk';

/**
 * Translate a `TaskOutput` from the runtime into the corresponding
 * `complete` / `fail` REST call.
 *
 * The runtime promises that every claimed task produces exactly one
 * `TaskOutput`; this is where we honour that contract on the wire.
 *
 * Cancelled outputs are NOT reported. When the imposer cancels a task,
 * the server has already moved the row into a terminal `cancelled`
 * state and signalled the workflow (#938). Calling `/fail` afterwards
 * returns 409 "Task is already in terminal state" — the daemon's
 * cancellation acknowledgement happens implicitly via the heartbeat
 * response that fired `reporter.cancelSignal`.
 *
 * Stage 3 (this commit): when the task input carries a
 * `successCriteria` envelope, evaluate the deterministic parts
 * (`assertions` only, for now) before submitting. Required-failed
 * assertions hard-fail the attempt with `criteria_unmet`; otherwise the
 * verification record is attached to /complete so the imposer (and the
 * server, which will re-run assertions) can see exactly what passed.
 *
 * Out-of-scope for Stage 3 v1 (tracked as `skip` in the verification
 * record):
 *   - `gates` (need CID resolver wiring)
 *   - `rubric` `minComposite` (judgment-task scoring lives elsewhere)
 *   - `sideEffects` (diary-entry requirements need diary access)
 */
export async function finalizeTask(
  agent: Agent,
  claimed: Pick<{ task: Task; attemptN: number }, 'task' | 'attemptN'>,
  output: TaskOutput,
): Promise<void> {
  if (output.status === 'cancelled') {
    return;
  }

  if (output.status === 'completed' && output.output && output.outputCid) {
    const sc = extractSuccessCriteria(claimed.task);
    if (sc) {
      const verification = buildVerificationRecord(
        sc,
        claimed.task.inputCid,
        output.output,
      );
      const failures = collectRequiredFailures(verification.results);
      if (failures.length > 0) {
        await agent.tasks.fail(output.taskId, output.attemptN, {
          error: makeCriteriaUnmetError(failures),
        });
        return;
      }
      await agent.tasks.complete(output.taskId, output.attemptN, {
        output: output.output,
        outputCid: output.outputCid,
        usage: output.usage,
        verification,
        ...(output.contentSignature
          ? { contentSignature: output.contentSignature }
          : {}),
      });
      return;
    }
    await agent.tasks.complete(output.taskId, output.attemptN, {
      output: output.output,
      outputCid: output.outputCid,
      usage: output.usage,
      ...(output.contentSignature
        ? { contentSignature: output.contentSignature }
        : {}),
    });
    return;
  }
  const error: NonNullable<Parameters<TasksNamespace['fail']>[2]>['error'] =
    output.error ?? {
      code: 'task_failed',
      message: 'Task execution failed before producing a valid output.',
      retryable: false,
    };
  await agent.tasks.fail(output.taskId, output.attemptN, { error });
}

/**
 * Return the SuccessCriteria attached to a task input, or null if the
 * imposer didn't supply one. The server validates shape at task-create
 * time — by the time a task lands here it's well-formed. We type-narrow
 * via a structural cast rather than running a TypeBox check at the hot
 * path.
 */
function extractSuccessCriteria(task: Task): SuccessCriteria | null {
  const candidate = (task.input as { successCriteria?: SuccessCriteria })
    .successCriteria;
  return candidate ?? null;
}

function buildVerificationRecord(
  sc: SuccessCriteria,
  inputCid: string,
  output: Record<string, unknown>,
): VerificationRecord {
  const results: VerificationResult[] = [];

  if (sc.assertions && sc.assertions.length > 0) {
    results.push(...evaluateAssertions(output, sc.assertions));
  }

  // Stage 3 v1: gates, rubric thresholds, and sideEffects are recorded
  // as `skip` so the verification record carries an honest "we did not
  // evaluate this" signal rather than a silent omission.
  if (sc.gates) {
    for (const gate of sc.gates) {
      results.push({
        id: gate.id,
        kind: 'gate',
        status: 'skip',
        detail: `gate kind '${gate.kind}' not yet evaluated by daemon`,
      });
    }
  }

  if (sc.minComposite !== undefined) {
    results.push({
      id: 'rubric-composite',
      kind: 'rubric',
      status: 'skip',
      detail: 'rubric scoring not yet evaluated by daemon',
    });
  }

  if (sc.sideEffects) {
    if (sc.sideEffects.diaryEntryRequired) {
      results.push({
        id: 'sideEffect-diaryEntryRequired',
        kind: 'sideEffect',
        status: 'skip',
        detail: 'sideEffect verification not yet evaluated by daemon',
      });
    }
    if (sc.sideEffects.referencedEntries !== undefined) {
      results.push({
        id: 'sideEffect-referencedEntries',
        kind: 'sideEffect',
        status: 'skip',
        detail: 'sideEffect verification not yet evaluated by daemon',
      });
    }
  }

  return {
    inputCid,
    results,
    passed: results.every((r) => r.status !== 'fail'),
  };
}

interface RequiredFailure {
  id: string;
  detail?: string;
}

/**
 * Collect failures that warrant hard-failing the attempt. v1: any failed
 * assertion. (Gates with `required: true` will join this list once they
 * actually run; today they `skip` so they cannot fail.)
 */
function collectRequiredFailures(
  results: readonly VerificationResult[],
): RequiredFailure[] {
  return results
    .filter((r) => r.kind === 'assertion' && r.status === 'fail')
    .map((r) => ({ id: r.id, detail: r.detail }));
}

function makeCriteriaUnmetError(
  failures: readonly RequiredFailure[],
): NonNullable<Parameters<TasksNamespace['fail']>[2]>['error'] {
  const summary = failures
    .map((f) => (f.detail ? `${f.id} (${f.detail})` : f.id))
    .join('; ');
  return {
    code: 'criteria_unmet',
    message: `Required success criteria not met: ${summary}`,
    retryable: true,
  };
}
