/**
 * FAKE — an in-memory stand-in for the MoltNet task API used only in tests.
 *
 * It models the parts of the real lifecycle the executor depends on:
 * idempotent creation (same key + same body returns the existing task; same
 * key + different body conflicts), queued → running → completed transitions
 * driven by a simulated agent, accepted attempts with output CIDs, failures,
 * and `claimCondition` gating on other tasks' status. Nothing here proves the
 * real server behaves this way; see the report for what remains unverified.
 */
import { createHash } from 'node:crypto';

import type {
  SdkTask,
  SdkTaskAttempt,
  TaskClient,
  TaskMessage,
} from '@themoltnet/tasks-orchestrator';

export type SimulatedOutcome =
  | { kind: 'complete'; output: unknown }
  | { kind: 'fail'; error: string };

/**
 * Decides what the simulated agent produces for a task. Called once per task
 * when the agent "claims" it. `pollsBeforeClaim` lets a test keep a task in
 * `queued` for a few polls so independent progress is observable.
 */
export type SimulatedAgent = (
  task: SdkTask,
  info: { createIndex: number; brief: string },
) => SimulatedOutcome | { kind: 'defer' };

export interface FakeTaskEvent {
  seq: number;
  kind:
    | 'created'
    | 'claimed'
    | 'completed'
    | 'failed'
    | 'idempotent_hit'
    | 'conflict';
  taskId: string;
  title: string | null;
  detail?: string;
}

interface Stored {
  task: SdkTask;
  attempts: SdkTaskAttempt[];
  body: Parameters<TaskClient['createTask']>[0];
  createIndex: number;
  polls: number;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k: string, v: unknown): unknown =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : v,
  );
}

type ClaimCondition = NonNullable<SdkTask['claimCondition']>;

export class IdempotencyConflictError extends Error {
  constructor(readonly key: string) {
    super(`Idempotency-Key ${key} was reused with a different body (409)`);
    this.name = 'IdempotencyConflictError';
  }
}

export class FakeTaskService implements TaskClient {
  readonly events: FakeTaskEvent[] = [];
  private readonly stored = new Map<string, Stored>();
  private readonly byIdempotency = new Map<
    string,
    { taskId: string; canonical: string }
  >();
  private seq = 0;
  private next = 1;
  agent: SimulatedAgent;
  /** Polls a queued task survives before the agent claims it. */
  pollsBeforeClaim = 1;
  /** Polls a running task survives before the agent completes it. */
  pollsBeforeComplete = 1;

  constructor(agent: SimulatedAgent) {
    this.agent = agent;
  }

  get tasks(): SdkTask[] {
    return [...this.stored.values()].map((s) => s.task);
  }

  private emit(kind: FakeTaskEvent['kind'], task: SdkTask, detail?: string) {
    this.seq += 1;
    this.events.push({
      seq: this.seq,
      kind,
      taskId: task.id,
      title: task.title ?? null,
      detail,
    });
  }

  createTask(
    body: Parameters<TaskClient['createTask']>[0],
    options?: { idempotencyKey?: string },
  ): Promise<SdkTask> {
    const key = options?.idempotencyKey
      ? `${body.teamId}:${options.idempotencyKey}`
      : null;
    const canon = canonical(body);
    if (key) {
      const hit = this.byIdempotency.get(key);
      if (hit) {
        const existing = this.stored.get(hit.taskId) as Stored;
        if (hit.canonical !== canon) {
          this.emit('conflict', existing.task, options?.idempotencyKey);
          return Promise.reject(
            new IdempotencyConflictError(options?.idempotencyKey ?? ''),
          );
        }
        this.emit('idempotent_hit', existing.task, options?.idempotencyKey);
        return Promise.resolve(existing.task);
      }
    }
    const id = `00000000-0000-4000-8000-${String(this.next).padStart(12, '0')}`;
    const createIndex = this.next;
    this.next += 1;
    const now = new Date().toISOString();
    const gated = body.claimCondition
      ? !this.conditionSatisfied(body.claimCondition)
      : false;
    const task = {
      id,
      taskType: body.taskType,
      title: body.title?.trim() || null,
      tags: [],
      teamId: body.teamId,
      diaryId: body.diaryId,
      projectId: null,
      outputKind: 'artifact',
      input: body.input,
      inputSchemaCid: 'cid',
      inputCid: `cid-in-${id}`,
      references: body.references ?? [],
      correlationId: body.correlationId ?? null,
      proposedByAgentId: 'orchestrator',
      proposedByHumanId: null,
      acceptedAttemptN: null,
      claimCondition: body.claimCondition ?? null,
      requiredExecutorTrustLevel:
        body.requiredExecutorTrustLevel ?? 'selfDeclared',
      allowedProfiles: body.allowedProfiles ?? [],
      status: gated ? 'waiting' : 'queued',
      queuedAt: now,
      completedAt: null,
      expiresAt: null,
      cancelledByAgentId: null,
      cancelledByHumanId: null,
      cancelReason: null,
      maxAttempts: body.maxAttempts ?? 1,
      dispatchTimeoutSec: null,
      runningTimeoutSec: null,
    } as unknown as SdkTask;
    this.stored.set(id, { task, attempts: [], body, createIndex, polls: 0 });
    if (key) this.byIdempotency.set(key, { taskId: id, canonical: canon });
    this.emit('created', task, options?.idempotencyKey);
    return Promise.resolve(task);
  }

  private conditionSatisfied(condition: ClaimCondition): boolean {
    if (condition.op === 'all') {
      return condition.conditions.every((x) => this.conditionSatisfied(x));
    }
    if (condition.op === 'any') {
      return condition.conditions.some((x) => this.conditionSatisfied(x));
    }
    const t = this.stored.get(condition.taskId)?.task;
    if (!t) return false;
    if (condition.op === 'task_status') {
      return condition.statuses.includes(t.status);
    }
    return t.acceptedAttemptN !== null;
  }

  /** Advance the simulated world by one tick for `taskId` (called on every poll). */
  private tick(entry: Stored): void {
    const { task } = entry;
    entry.polls += 1;
    if (
      task.status === 'waiting' &&
      task.claimCondition &&
      this.conditionSatisfied(task.claimCondition)
    ) {
      (task as { status: string }).status = 'queued';
      entry.polls = 0;
      return;
    }
    if (task.status === 'queued' && entry.polls >= this.pollsBeforeClaim) {
      const brief = String((task.input as { brief?: string })?.brief ?? '');
      const decision = this.agent(task, {
        createIndex: entry.createIndex,
        brief,
      });
      if (decision.kind === 'defer') return;
      const attemptN = entry.attempts.length + 1;
      const now = new Date().toISOString();
      const attempt = {
        taskId: task.id,
        attemptN,
        claimedByAgentId: 'simulated-agent',
        runtimeId: null,
        claimedAt: now,
        startedAt: now,
        completedAt: null,
        status: 'running',
        output: null,
        outputCid: null,
        claimedExecutorFingerprint: null,
        claimedExecutorManifest: null,
        completedExecutorFingerprint: null,
        completedExecutorManifest: null,
        error: null,
        usage: null,
        contentSignature: null,
        signedAt: null,
        daemonState: null,
      } as unknown as SdkTaskAttempt & { pending?: SimulatedOutcome };
      (attempt as { pending?: SimulatedOutcome }).pending = decision;
      entry.attempts.push(attempt);
      (task as { status: string }).status = 'running';
      entry.polls = 0;
      this.emit('claimed', task, `attempt ${attemptN}`);
      return;
    }
    if (task.status === 'running' && entry.polls >= this.pollsBeforeComplete) {
      const attempt = entry.attempts[
        entry.attempts.length - 1
      ] as SdkTaskAttempt & { pending?: SimulatedOutcome };
      const pending = attempt.pending as SimulatedOutcome;
      delete attempt.pending;
      const now = new Date().toISOString();
      (attempt as { completedAt: string | null }).completedAt = now;
      if (pending.kind === 'complete') {
        (attempt as { status: string }).status = 'completed';
        (attempt as { output: unknown }).output = pending.output;
        (attempt as { outputCid: string | null }).outputCid =
          'bafy-' +
          createHash('sha256')
            .update(canonical(pending.output))
            .digest('hex')
            .slice(0, 16);
        (task as { status: string }).status = 'completed';
        (task as { acceptedAttemptN: number | null }).acceptedAttemptN =
          attempt.attemptN;
        (task as { completedAt: string | null }).completedAt = now;
        this.emit(
          'completed',
          task,
          `attempt ${attempt.attemptN} cid ${attempt.outputCid}`,
        );
      } else {
        (attempt as { status: string }).status = 'failed';
        (attempt as { error: unknown }).error = { message: pending.error };
        if (entry.attempts.length >= (task.maxAttempts ?? 1)) {
          (task as { status: string }).status = 'failed';
          (task as { completedAt: string | null }).completedAt = now;
          this.emit('failed', task, pending.error);
        } else {
          (task as { status: string }).status = 'queued';
          entry.polls = 0;
        }
      }
    }
  }

  getTask(id: string): Promise<SdkTask> {
    const entry = this.stored.get(id);
    if (!entry) return Promise.reject(new Error(`missing task ${id}`));
    this.tick(entry);
    return Promise.resolve({ ...entry.task });
  }

  listAttempts(id: string): Promise<SdkTaskAttempt[]> {
    const entry = this.stored.get(id);
    if (!entry) return Promise.reject(new Error(`missing task ${id}`));
    return Promise.resolve(entry.attempts.map((a) => ({ ...a })));
  }

  listMessages(): Promise<TaskMessage[]> {
    return Promise.resolve([]);
  }

  /** Test helper: the create body the fake received for a task. */
  bodyOf(taskId: string): Parameters<TaskClient['createTask']>[0] | undefined {
    return this.stored.get(taskId)?.body;
  }
}
