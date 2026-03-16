import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { AxGEPAAdapter, AxGEPAEvaluationBatch } from '@ax-llm/ax';
import fastq from 'fastq';

import type { GpackOutput } from './adapter.js';
import { runAgentTask } from './agent-runner.js';
import { createWorktree, removeWorktree } from './evaluate.js';
import { execFileText } from './process.js';
import type {
  SkillEvalAdapterOptions,
  SkillEvalTask,
  SkillEvalTrace,
} from './skill-types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskResult {
  index: number;
  output: GpackOutput;
  score: number;
  trajectory?: SkillEvalTrace;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class SkillEvalAdapter implements AxGEPAAdapter<
  SkillEvalTask,
  SkillEvalTrace,
  GpackOutput
> {
  private lastBatch: readonly SkillEvalTask[] = [];

  constructor(private options: SkillEvalAdapterOptions) {}

  async evaluate(
    batch: readonly SkillEvalTask[],
    candidate: Readonly<Record<string, string>>,
    captureTraces?: boolean,
  ): Promise<AxGEPAEvaluationBatch<SkillEvalTrace, GpackOutput>> {
    const {
      mcpServers,
      agentConfigDir,
      agentName,
      agentEnv,
      scorer,
      claudeModel,
      verbose,
      concurrency = 1,
    } = this.options;

    const skillText = candidate['instruction'] ?? '';
    this.lastBatch = batch;

    const worker = async (item: {
      task: SkillEvalTask;
      index: number;
    }): Promise<TaskResult> => {
      const { task, index } = item;
      if (verbose) {
        console.log(`[skill-eval] task=${task.id}`);
      }

      let worktreeDir: string | undefined;
      try {
        // 1. Create worktree
        worktreeDir = await createWorktree(task.baseCommit, task.id);

        // 2. Copy agent config
        const targetMoltnet = resolve(worktreeDir, '.moltnet', agentName);
        await mkdir(targetMoltnet, { recursive: true });
        await cp(agentConfigDir, targetMoltnet, { recursive: true });

        // 3. Write skill to the worktree
        const skillDir = resolve(
          worktreeDir,
          ...task.skillPath.split('/').slice(0, -1),
        );
        await mkdir(skillDir, { recursive: true });
        await writeFile(
          resolve(worktreeDir, task.skillPath),
          skillText,
          'utf8',
        );

        // 4. Apply patches
        for (const patchFile of task.patchFiles) {
          const patchPath = resolve(this.options.repoRoot, patchFile);
          await execFileText('git', ['apply', patchPath], {
            cwd: worktreeDir,
          });
        }

        // 5. Run Claude Code agent
        const agentResult = await runAgentTask({
          cwd: worktreeDir,
          prompt: task.taskPrompt,
          model: claudeModel,
          maxTurns: 30,
          clientApp: '@moltnet/tools:skill-eval',
          mcpServers,
          extraEnv: {
            GIT_CONFIG_GLOBAL: resolve(
              worktreeDir,
              '.moltnet',
              agentName,
              'gitconfig',
            ),
            MOLTNET_CREDENTIALS_PATH: resolve(
              worktreeDir,
              '.moltnet',
              agentName,
              'moltnet.json',
            ),
            ...agentEnv,
            ...task.env,
          },
        });

        // 6. Score
        if (task.expected === undefined) {
          console.warn(
            `[skill-eval] task=${task.id} skipped scoring: expected is undefined`,
          );
          return {
            index,
            output: { taskId: task.id, score: 0 },
            score: 0,
            trajectory: captureTraces
              ? {
                  taskId: task.id,
                  worktreeDir,
                  taskPrompt: task.taskPrompt,
                  executor: 'anthropic-sdk' as const,
                  sessionId: agentResult.sessionId,
                  turnCount: agentResult.turnCount,
                  durationMs: agentResult.durationMs,
                  costUsd: agentResult.costUsd,
                  toolCallCount: agentResult.toolCallCount,
                  toolSummaries: agentResult.toolSummaries,
                  scoreResult: { warning: 'task.expected is undefined' },
                }
              : undefined,
          };
        }
        const scoreResult = await scorer.score(worktreeDir, task.expected, {
          baseCommit: task.baseCommit,
        });
        const numericScore = scorer.toNumeric(scoreResult);

        return {
          index,
          output: { taskId: task.id, score: numericScore },
          score: numericScore,
          trajectory: captureTraces
            ? {
                taskId: task.id,
                worktreeDir,
                taskPrompt: task.taskPrompt,
                executor: 'anthropic-sdk' as const,
                sessionId: agentResult.sessionId,
                turnCount: agentResult.turnCount,
                durationMs: agentResult.durationMs,
                costUsd: agentResult.costUsd,
                toolCallCount: agentResult.toolCallCount,
                toolSummaries: agentResult.toolSummaries,
                scoreResult,
              }
            : undefined,
        };
      } catch (err) {
        console.error(`[skill-eval] task=${task.id} error:`, err);
        return {
          index,
          output: { taskId: task.id, score: 0 },
          score: 0,
          trajectory: captureTraces
            ? {
                taskId: task.id,
                taskPrompt: task.taskPrompt,
                executor: 'anthropic-sdk' as const,
                scoreResult: { error: String(err) },
              }
            : undefined,
        };
      } finally {
        if (worktreeDir) {
          await removeWorktree(worktreeDir);
        }
      }
    };

    const q = fastq.promise(worker, concurrency);
    const results = await Promise.all(
      batch.map((task, index) => q.push({ task, index })),
    );

    results.sort((a, b) => a.index - b.index);

    return {
      outputs: results.map((r) => r.output),
      scores: results.map((r) => r.score),
      trajectories: captureTraces ? results.map((r) => r.trajectory!) : null,
    };
  }

  make_reflective_dataset(
    _candidate: Readonly<Record<string, string>>,
    evalBatch: Readonly<AxGEPAEvaluationBatch<SkillEvalTrace, GpackOutput>>,
    componentsToUpdate: readonly string[],
  ): Record<string, unknown[]> {
    const { scorer } = this.options;
    const dataset: Record<string, unknown[]> = {};

    for (const component of componentsToUpdate) {
      dataset[component] = [];

      const traces = evalBatch.trajectories ?? [];
      const batchOutputs = evalBatch.outputs;

      for (let i = 0; i < batchOutputs.length; i++) {
        const output = batchOutputs[i];
        const trace = traces[i];
        const task = this.lastBatch.find((t) => t.id === output.taskId);
        if (!task) continue;

        const feedback =
          output.score >= 1
            ? `All criteria passed (score=${output.score.toFixed(2)})`
            : trace?.scoreResult !== undefined && trace?.scoreResult !== null
              ? scorer.toFeedback(trace.scoreResult, task)
              : 'No score result available';

        dataset[component].push({
          Inputs: {
            task_id: output.taskId,
            task_prompt: task.taskPrompt,
            expected: task.expected,
          },
          'Generated Outputs': {
            score: output.score,
          },
          Feedback: feedback,
        });
      }
    }

    return dataset;
  }
}
