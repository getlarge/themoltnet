import {
  createOrchestrationAbsurdApp,
  parallelTasks,
  type WorkflowContext,
} from '@themoltnet/tasks-orchestrator';
import { describe, expect, it } from 'vitest';

/**
 * Durability E2E against a REAL Absurd Postgres (the `issue-lifecycle-db`
 * service in docker-compose.e2e.yaml). This proves the property the whole
 * `@themoltnet/tasks-orchestrator` design rests on — that completed `ctx.step`
 * checkpoints are replayed from Absurd's store and NOT re-executed when a run is
 * retried after a mid-run failure. The unit suites in `libs/tasks-orchestrator` cover
 * the same primitives with `inlineContext` / a fake memoizing ctx; only a real
 * Absurd worker can prove the checkpoint store actually behaves this way.
 *
 * `ORCHESTRATION_ABSURD_URL` is set by globalSetup (defaults to the local
 * issue-lifecycle-db). A dedicated queue keeps these tasks off any other worker
 * polling the stack, so only the in-test worker drains them.
 */
const ABSURD_URL = process.env.ORCHESTRATION_ABSURD_URL as string;
const QUEUE =
  process.env.ORCHESTRATION_ABSURD_QUEUE ?? 'orchestration-durability';

describe('orchestration durability (real Absurd)', () => {
  it('replays completed steps from checkpoints instead of re-executing them after a mid-run crash', async () => {
    // Observable "external mutations" (stand-ins for task creation). Because the
    // Absurd worker runs in THIS process, these closure vars survive the task
    // retry, so we can assert each step body ran exactly once.
    const created: string[] = [];
    let crashStepCalls = 0;

    const run = async (
      input: { items: string[] },
      ctx: WorkflowContext,
    ): Promise<{ ids: string[]; createdCount: number }> => {
      const ids: string[] = [];
      for (let i = 0; i < input.items.length; i += 1) {
        const item = input.items[i];
        const id = await ctx.step(`create.${i}`, () => {
          created.push(item); // the durable side effect we must not duplicate
          return Promise.resolve(`id-${item}`);
        });
        ids.push(id);
      }
      // Fail once, AFTER the creates are checkpointed, to force an Absurd retry.
      // The retry re-runs this handler; the creates above must come back from the
      // checkpoint store (their bodies must not run again).
      await ctx.step('crash-once', () => {
        crashStepCalls += 1;
        if (crashStepCalls === 1) {
          throw new Error('simulated mid-run crash');
        }
        return Promise.resolve('recovered');
      });
      return { ids, createdCount: created.length };
    };

    const app = createOrchestrationAbsurdApp<{ items: string[] }>({
      databaseUrl: ABSURD_URL,
      queueName: QUEUE,
      taskName: 'durability_replay',
      defaultMaxAttempts: 3,
      run,
    });

    let worker: Awaited<ReturnType<typeof app.startWorker>> | null = null;
    try {
      await app.createQueue(QUEUE);
      const spawned = await app.spawn(
        'durability_replay',
        { items: ['a', 'b', 'c'] },
        {
          queue: QUEUE,
          maxAttempts: 3,
          retryStrategy: { kind: 'fixed', baseSeconds: 0 },
          idempotencyKey: `durability-replay-${process.pid}-${Math.trunc(
            performance.now(),
          )}`,
        },
      );
      worker = await app.startWorker({ concurrency: 1 });
      const result = await app.awaitTaskResult(spawned.taskID, { timeout: 45 });

      expect(result.state).toBe('completed');
      // The crash forced a second attempt...
      expect(crashStepCalls).toBe(2);
      // ...but the three creates each ran EXACTLY once — replayed from the
      // checkpoint store on the retry, never duplicated.
      expect(created).toEqual(['a', 'b', 'c']);
    } finally {
      await worker?.close();
      await app.close();
    }
  }, 60_000);

  it('parallelTasks fan-out is replay-safe: creates are not duplicated after a mid-run crash', async () => {
    // Proves the lib's own primitive (Promise.all over ctx.step) works under
    // real Absurd — its concurrent per-item step checkpoints must each replay
    // exactly once on retry, not re-create.
    const created: string[] = [];
    let crashStepCalls = 0;

    const run = async (
      input: { items: string[] },
      ctx: WorkflowContext,
    ): Promise<{ ids: string[]; createdCount: number }> => {
      const { created: createdTasks, results } = await parallelTasks<
        string,
        { id: string },
        string
      >({
        ctx,
        items: input.items,
        createStepName: (_item, index) => `fanout.${index}.create`,
        create: (item) => {
          created.push(item); // the side effect we must not duplicate
          return Promise.resolve({ id: `id-${item}` });
        },
        awaitResult: (task) => Promise.resolve(task.id),
      });

      await ctx.step('crash-once', () => {
        crashStepCalls += 1;
        if (crashStepCalls === 1) {
          throw new Error('simulated mid-run crash after fan-out');
        }
        return Promise.resolve('recovered');
      });

      return {
        ids: createdTasks.map((task) => task.id),
        createdCount: results.length,
      };
    };

    const app = createOrchestrationAbsurdApp<{ items: string[] }>({
      databaseUrl: ABSURD_URL,
      queueName: QUEUE,
      taskName: 'durability_parallel_replay',
      defaultMaxAttempts: 3,
      run,
    });

    let worker: Awaited<ReturnType<typeof app.startWorker>> | null = null;
    try {
      await app.createQueue(QUEUE);
      const spawned = await app.spawn(
        'durability_parallel_replay',
        { items: ['x', 'y', 'z', 'w'] },
        {
          queue: QUEUE,
          maxAttempts: 3,
          retryStrategy: { kind: 'fixed', baseSeconds: 0 },
          idempotencyKey: `durability-parallel-${process.pid}-${Math.trunc(
            performance.now(),
          )}`,
        },
      );
      worker = await app.startWorker({ concurrency: 1 });
      const result = await app.awaitTaskResult(spawned.taskID, { timeout: 45 });

      expect(result.state).toBe('completed');
      expect(crashStepCalls).toBe(2);
      // Each of the four fan-out creates ran exactly once despite the retry —
      // the concurrent per-item checkpoints replayed from the store.
      expect([...created].sort()).toEqual(['w', 'x', 'y', 'z']);
    } finally {
      await worker?.close();
      await app.close();
    }
  }, 60_000);
});
