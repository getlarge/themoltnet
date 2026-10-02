/**
 * OPT-IN: real Absurd Postgres durability for the plan executor.
 *
 * Skipped unless `ORCHESTRATION_ABSURD_URL` points at an Absurd-initialized
 * database (the `issue-lifecycle-db` service of docker-compose.e2e.yaml after
 * `pnpm run e2e:up`). It runs the reference plan through
 * `createOrchestrationAbsurdApp`, crashes the workflow once after the first
 * task creations, lets Absurd retry it, and asserts that no task was created
 * twice. The MoltNet task API and the reviewer are still FAKES; only the
 * checkpoint store is real.
 *
 * Not executed in the research session that authored it (no Docker daemon,
 * no Postgres cluster permitted); see docs/research/windags-absurd-planning.md.
 */
import { createOrchestrationAbsurdApp } from '@themoltnet/tasks-orchestrator';
import { describe, expect, it } from 'vitest';

import { citationsResolve } from '../testing/domain-checks.js';
import { FakeDecisionStore } from '../testing/fake-decision-store.js';
import { FakeTaskService } from '../testing/fake-task-service.js';
import { referencePlan } from '../testing/reference-plan.js';
import { executePlan } from './execute-plan.js';

// eslint-disable-next-line no-restricted-syntax -- opt-in e2e switch, mirrors apps/orchestration-e2e
const ABSURD_URL = process.env.ORCHESTRATION_ABSURD_URL;

describe.skipIf(!ABSURD_URL)('executePlan on real Absurd (opt-in)', () => {
  it('replays task-create checkpoints after a mid-run crash without duplicating tasks', async () => {
    const queue = `workflow-plan-${process.pid}-${Date.now()}`;
    const outputs: Record<string, unknown> = {
      'Read evidence set A': {
        set: 'A',
        findings: [{ claim: 'a', cites: ['A1'] }],
      },
      'Read evidence set B': {
        set: 'B',
        findings: [{ claim: 'b', cites: ['B1'] }],
      },
      'Merge both': { statements: [{ text: 's', cites: ['A1', 'B1'] }] },
      'Write a short summary': { summary: 'ok', basedOnSynthesisRevision: 1 },
    };
    const tasks = new FakeTaskService((_task, { brief }) => {
      const key = Object.keys(outputs).find((k) => brief.startsWith(k));
      return key
        ? { kind: 'complete', output: outputs[key] }
        : { kind: 'fail', error: brief.slice(0, 40) };
    });
    const decisions = new FakeDecisionStore();
    decisions.script('owner-decision', () => 'approve');
    let crashes = 0;
    const app = createOrchestrationAbsurdApp<{ planId: string }>({
      databaseUrl: ABSURD_URL as string,
      queueName: queue,
      taskName: 'workflow_plan_execute',
      defaultMaxAttempts: 3,
      run: (_input, ctx) =>
        executePlan(referencePlan(), ctx, {
          tasks,
          decisions,
          domainChecks: { 'citations-resolve': citationsResolve },
          pollIntervalSec: 1,
          hooks: {
            afterTaskCreate: ({ node }) => {
              if (node === 'process-b' && crashes === 0) {
                crashes += 1;
                throw new Error(
                  'simulated worker crash after process-b create',
                );
              }
            },
          },
        }),
    });
    let worker: Awaited<ReturnType<typeof app.startWorker>> | null = null;
    try {
      await app.createQueue(queue);
      const { taskID } = await app.spawn(
        'workflow_plan_execute',
        { planId: 'evidence-synthesis-reference' },
        {
          queue,
          maxAttempts: 3,
          retryStrategy: { kind: 'fixed', baseSeconds: 0 },
        },
      );
      worker = await app.startWorker({ concurrency: 1 });
      const result = (await app.awaitTaskResult(taskID, {
        timeout: 120,
      })) as unknown as { status: string; tasksCreated: number };
      expect(result.status).toBe('completed');
      expect(crashes).toBe(1);
      expect(tasks.events.filter((e) => e.kind === 'created')).toHaveLength(4);
      expect(tasks.events.filter((e) => e.kind === 'conflict')).toHaveLength(0);
    } finally {
      await worker?.close();
      await app.close();
    }
  }, 180_000);
});
