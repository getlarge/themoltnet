import { executeAdaptiveStage } from '../../src/execution.js';

await executeAdaptiveStage({
  databaseUrl: process.env.ADAPTIVE_TEST_DATABASE_URL as string,
  executionId: process.env.ADAPTIVE_TEST_EXECUTION_ID as string,
  stage: 'review',
  input: {},
  run: async (_input, ctx) => {
    await ctx.step('retention-test-progress', async () => ({
      taskId: 'existing-task',
    }));
    process.stdout.write('RETENTION_WORKER_READY\n');
    return new Promise<never>(() => {});
  },
});
