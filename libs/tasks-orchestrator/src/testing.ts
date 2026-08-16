import type {
  SdkTask,
  SdkTaskAttempt,
  TaskClient,
  TaskMessage,
} from './types.js';

/**
 * A scripted fake task output. A plain object is treated as a success body and
 * wrapped via `wrapOutput`; the tagged variants force a terminal failure or a
 * raw (unwrapped) attempt output.
 */
export type FakeTaskOutput =
  | Record<string, unknown>
  | {
      __taskStatus: 'failed' | 'cancelled';
      error?: unknown;
      messages?: TaskMessage[];
    }
  | { __rawOutput: unknown };

export type FakeTaskOutputSource =
  | FakeTaskOutput[]
  | ((
      body: Parameters<TaskClient['createTask']>[0],
      index: number,
    ) => FakeTaskOutput);

export interface FakeTasksOptions {
  /**
   * Wrap a plain success body into the `SdkTaskAttempt.output` shape the domain
   * parser expects. Default: identity (the body IS the output). Apps whose
   * parser reads an artifact envelope pass their own wrapper here.
   */
  wrapOutput?: (body: Record<string, unknown>) => unknown;
}

function isTerminalFakeOutput(
  output: FakeTaskOutput,
): output is Extract<FakeTaskOutput, { __taskStatus: 'failed' | 'cancelled' }> {
  return (
    '__taskStatus' in output &&
    (output.__taskStatus === 'failed' || output.__taskStatus === 'cancelled')
  );
}

function isRawFakeOutput(
  output: FakeTaskOutput,
): output is Extract<FakeTaskOutput, { __rawOutput: unknown }> {
  return '__rawOutput' in output;
}

/**
 * In-memory {@link TaskClient} for synchronous workflow tests. By default each
 * `createTask` consumes the next scripted output. Tests whose workflow creates
 * siblings concurrently can instead supply a function that selects an output
 * from the task body, avoiding scheduler-dependent FIFO fixtures. Recorded
 * create bodies are exposed via `created`.
 */
export class FakeTasks implements TaskClient {
  readonly created: Array<Parameters<TaskClient['createTask']>[0]> = [];
  readonly creationOptions: Array<
    Parameters<TaskClient['createTask']>[1] | undefined
  > = [];
  private readonly tasks = new Map<string, SdkTask>();
  private readonly attempts = new Map<string, SdkTaskAttempt[]>();
  private readonly messages = new Map<string, TaskMessage[]>();
  private next = 1;
  private readonly wrapOutput: (body: Record<string, unknown>) => unknown;

  constructor(
    private readonly outputs: FakeTaskOutputSource,
    options: FakeTasksOptions = {},
  ) {
    this.wrapOutput = options.wrapOutput ?? ((body) => body);
  }

  createTask(
    body: Parameters<TaskClient['createTask']>[0],
    options?: Parameters<TaskClient['createTask']>[1],
  ): Promise<SdkTask> {
    const id = `00000000-0000-4000-8000-${String(this.next).padStart(12, '0')}`;
    this.next += 1;
    const output =
      typeof this.outputs === 'function'
        ? this.outputs(body, this.next - 2)
        : this.outputs.shift();
    if (!output) throw new Error('test exhausted fake outputs');
    const terminalOutput = isTerminalFakeOutput(output) ? output : null;
    const rawOutput = isRawFakeOutput(output) ? output.__rawOutput : null;
    const failedStatus = terminalOutput?.__taskStatus ?? null;
    const now = new Date().toISOString();
    const task = {
      id,
      taskType: body.taskType,
      title: body.title ?? null,
      tags: [],
      teamId: body.teamId,
      diaryId: body.diaryId,
      outputKind: 'artifact',
      input: body.input,
      inputSchemaCid: 'cid',
      inputCid: 'cid',
      references: body.references ?? [],
      correlationId: body.correlationId ?? null,
      proposedByAgentId: 'agent',
      proposedByHumanId: null,
      acceptedAttemptN: failedStatus ? null : 1,
      claimCondition: body.claimCondition ?? null,
      requiredExecutorTrustLevel:
        body.requiredExecutorTrustLevel ?? 'selfDeclared',
      allowedProfiles: body.allowedProfiles ?? [],
      status: failedStatus ?? 'completed',
      queuedAt: now,
      completedAt: now,
      expiresAt: null,
      cancelledByAgentId: null,
      cancelledByHumanId: null,
      cancelReason: null,
      maxAttempts: body.maxAttempts ?? 1,
      dispatchTimeoutSec: body.dispatchTimeoutSec ?? null,
      runningTimeoutSec: body.runningTimeoutSec ?? null,
    } as SdkTask;
    const attempt = {
      taskId: id,
      attemptN: 1,
      claimedByAgentId: 'agent',
      runtimeId: null,
      claimedAt: now,
      startedAt: now,
      completedAt: now,
      status: failedStatus ?? 'completed',
      output: failedStatus
        ? null
        : (rawOutput ?? this.wrapOutput(output as Record<string, unknown>)),
      outputCid: failedStatus ? null : `cid-${id}`,
      claimedExecutorFingerprint: null,
      claimedExecutorManifest: null,
      completedExecutorFingerprint: null,
      completedExecutorManifest: null,
      error: terminalOutput ? (terminalOutput.error ?? null) : null,
      usage: null,
      contentSignature: null,
      signedAt: null,
      daemonState: {
        reportedAt: now,
        slotResumableUntil: new Date(Date.now() + 60_000).toISOString(),
      },
    } as SdkTaskAttempt;
    this.created.push(body);
    this.creationOptions.push(options);
    this.tasks.set(id, task);
    this.attempts.set(id, [attempt]);
    if (terminalOutput?.messages) {
      this.messages.set(`${id}:1`, terminalOutput.messages);
    }
    return Promise.resolve(task);
  }

  getTask(id: string): Promise<SdkTask> {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`missing task ${id}`);
    return Promise.resolve(task);
  }

  listAttempts(id: string): Promise<SdkTaskAttempt[]> {
    const attempts = this.attempts.get(id);
    if (!attempts) throw new Error(`missing attempt ${id}`);
    return Promise.resolve(attempts);
  }

  listMessages(id: string, attemptN: number): Promise<TaskMessage[]> {
    return Promise.resolve(this.messages.get(`${id}:${attemptN}`) ?? []);
  }
}
