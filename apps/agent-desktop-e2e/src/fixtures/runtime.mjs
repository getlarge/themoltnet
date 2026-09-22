import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeJsonCid } from '@moltnet/crypto-service';

// Deterministic execution only; claiming, authorization and reporting use the
// production daemon and Docker API. Workspace preparation stays production-owned;
// this adapter makes no model calls.
export default {
  runtimeKind: 'desktop_e2e',
  async prepare({ profile }) {
    return {
      runtimeKind: 'desktop_e2e',
      manifest: {
        profile: { id: profile.id, definitionCid: profile.definitionCid },
        runtime: { kind: 'desktop_e2e' },
      },
      tools: [],
      executables: [],
      createTaskExecutor(options) {
        return async (claimed, reporter) => {
          await reporter.open({
            taskId: claimed.task.id,
            attemptN: claimed.attemptN,
          });
          const plan = await options.makeExecutionPlan(claimed);
          const sessionDir = plan.sessionPersistence?.sessionDir;
          if (!sessionDir)
            throw new Error('Desktop executor requires a persisted session');
          mkdirSync(sessionDir, { recursive: true });
          writeFileSync(
            join(sessionDir, 'desktop.jsonl'),
            JSON.stringify({
              type: 'session',
              taskId: claimed.task.id,
              attemptN: claimed.attemptN,
            }) + '\n',
          );
          const output = {
            summary: 'Desktop personal journey completed.',
            verification: {
              inputCid: claimed.task.inputCid,
              passed: true,
              results: [
                {
                  id: 'desktop-journey',
                  kind: 'gate',
                  status: 'pass',
                  detail: 'Executed through the native Desktop managed worker.',
                },
              ],
            },
          };
          const usage = { inputTokens: 0, outputTokens: 0 };
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
        };
      },
    };
  },
};
