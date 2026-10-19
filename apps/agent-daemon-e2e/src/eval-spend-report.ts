import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  collectEvalSpend,
  type EvalSpendTask,
  formatEvalSpendReport,
  type SpendAttempt,
} from '@moltnet/agent-eval';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

function gitRevision(ref: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', ref], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim();
  } catch {
    return undefined;
  }
}

function runtimeImageId(): string | undefined {
  if (!process.env.REST_API_IMAGE) return undefined;
  try {
    return execFileSync(
      'docker',
      ['image', 'inspect', process.env.REST_API_IMAGE, '--format', '{{.Id}}'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5_000,
      },
    ).trim();
  } catch {
    return undefined;
  }
}

/** Register immediately after task creation; collect before the ephemeral DB is torn down. */
export function createEvalSpendReporter(suite: string) {
  const tasks = new Map<string, EvalSpendTask>();
  const outputDir = process.env.EVAL_SPEND_DIR;
  return {
    track(task: EvalSpendTask): void {
      tasks.set(task.taskId, task);
    },
    result(
      taskId: string,
      evaluation: NonNullable<EvalSpendTask['evaluation']>,
    ): void {
      const task = tasks.get(taskId);
      if (task) tasks.set(taskId, { ...task, evaluation });
    },
    async write(agent?: {
      tasks: { listAttempts(taskId: string): Promise<SpendAttempt[]> };
    }): Promise<void> {
      if (!outputDir) return;
      const report = await collectEvalSpend(
        {
          suite,
          collectedAt: new Date().toISOString(),
          event: process.env.GITHUB_EVENT_NAME,
          schedule: process.env.EVAL_SCHEDULE,
          runId: process.env.GITHUB_RUN_ID,
          runAttempt: process.env.GITHUB_RUN_ATTEMPT,
          job: process.env.GITHUB_JOB,
          sourceSha: gitRevision('HEAD'),
          corpusRevision: gitRevision('HEAD:evals-v2'),
          pricingCatalogSha256: createHash('sha256')
            .update(
              readFileSync(
                join(
                  REPO_ROOT,
                  'libs/provider-catalog/src/ollama-cloud-models.generated.ts',
                ),
              ),
            )
            .digest('hex'),
          restApiImage: runtimeImageId(),
        },
        [...tasks.values()],
        async (taskId) => {
          if (!agent) throw new Error('Eval agent unavailable');
          return agent.tasks.listAttempts(taskId);
        },
      );
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(
        join(outputDir, `${suite}.json`),
        JSON.stringify(report, null, 2) + '\n',
      );
      writeFileSync(
        join(outputDir, `${suite}.md`),
        formatEvalSpendReport(report),
      );
    },
  };
}
