/** Script executor output; use the real daemon claim, attestation and finalize paths. */
import { computeJsonCid } from '@moltnet/crypto-service';
import type { ClassifyInput, ClassifyOutput } from '@moltnet/tasks';
import { runAgentDaemonCli } from '@themoltnet/agent-daemon';
import type { DaemonRuntimeAdapter } from '@themoltnet/agent-daemon/runtime';

const runtimeKind = 'adaptive_review_e2e';
const runtime: DaemonRuntimeAdapter = {
  runtimeKind,
  prepare: ({ profile }) =>
    Promise.resolve({
      runtimeKind,
      manifest: {
        schemaVersion: 'moltnet:executor-manifest:v1',
        runtime: { kind: runtimeKind, id: 'adaptive-review-e2e', version: '1' },
        profile: { id: profile.id, definitionCid: profile.definitionCid },
        tools: [],
        executables: [],
      },
      tools: [],
      executables: [],
      createTaskExecutor: (options) => async (claimed, reporter) => {
        await reporter.open({
          taskId: claimed.task.id,
          attemptN: claimed.attemptN,
        });
        await options.makeExecutionPlan?.(claimed);
        let output: Record<string, unknown>;
        if (claimed.task.taskType === 'classify') {
          const input = claimed.task.input as ClassifyInput;
          const answers: ClassifyOutput['answers'] = {};
          for (const [name, question] of Object.entries(input.questions)) {
            if (question.type === 'bool')
              answers[name] = {
                type: 'bool',
                probability:
                  process.env.ADAPTIVE_E2E_RUN_LANE === 'true' ? 1 : 0,
              };
            else if (question.type === 'score')
              answers[name] = { type: 'score', score: 0, confidence: 1 };
            else {
              const choices = Object.keys(question.criteria);
              answers[name] = {
                type: 'choice',
                choice: choices[0],
                probabilities: Object.fromEntries(
                  choices.map((choice, index) => [choice, index === 0 ? 1 : 0]),
                ),
                confidence: 1,
              };
            }
          }
          output = { version: 1, answers };
        } else {
          output = {
            summary: 'Scripted review executor completed',
            verification: {
              inputCid: claimed.task.inputCid,
              results: [],
              passed: true,
            },
            result: {
              summary: 'Checked pinned change',
              findings: [],
              unclear: [],
            },
          };
        }
        const usage = { inputTokens: 1, outputTokens: 1 };
        await reporter.finalize(usage);
        await reporter.close();
        return {
          taskId: claimed.task.id,
          attemptN: claimed.attemptN,
          status: 'completed',
          output,
          outputCid: await computeJsonCid(output),
          usage,
          durationMs: 1,
        };
      },
    }),
};

process.argv.push('--debug');
runAgentDaemonCli({ runtime })
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
