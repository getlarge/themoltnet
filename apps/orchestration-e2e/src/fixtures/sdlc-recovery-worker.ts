import {
  type ConvergencePort,
  createConvergenceApp,
  type Revision,
} from '@moltnet/sdlc';
import { Client } from 'pg';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
const databaseUrl = env('ORCHESTRATION_ABSURD_URL');
const queueName = env('SDLC_RECOVERY_QUEUE');
const taskId = env('SDLC_RECOVERY_TASK');
const mode = env('SDLC_RECOVERY_MODE');
const db = new Client({ connectionString: databaseUrl });
await db.connect();
const revision: Revision = {
  base: 'base',
  head: 'head',
  policyDigest: 'policy',
  briefDigest: 'brief',
};
const port: ConvergencePort = {
  async observe() {
    const result = await db.query<{ completed: boolean }>(
      'SELECT completed FROM sdlc_recovery_repairs WHERE run_key=$1',
      [queueName],
    );
    return {
      current: revision,
      control: 'active',
      assessment: { revision, status: 'passed' },
      checks: {},
      requiredChecks: [],
      requiredLanes: ['tests'],
      auditLanes: [],
      unresolvedHumanThreads: 0,
      reviews: {
        tests: {
          revision,
          status: 'passed',
          findings: result.rows[0]?.completed
            ? [
                {
                  id: 'defect',
                  origin: 'introduced',
                  disposition: 'fixed',
                  verification: {
                    revision,
                    evidence: 'accepted-independent-verification',
                  },
                },
              ]
            : [{ id: 'defect', origin: 'introduced', disposition: 'open' }],
        },
      },
    };
  },
  async startRepair({ key }) {
    await db.query(
      'INSERT INTO sdlc_recovery_repairs (run_key, operation_key, completed) VALUES ($1,$2,false) ON CONFLICT (run_key,operation_key) DO NOTHING',
      [queueName, key],
    );
    if (mode === 'initial') {
      process.stdout.write('EFFECT_WRITTEN\n');
      await new Promise<never>(() => {});
    }
    return { taskId: key };
  },
  async repairState() {
    await db.query(
      'UPDATE sdlc_recovery_repairs SET completed=true WHERE run_key=$1',
      [queueName],
    );
    return 'accepted';
  },
  cancelRepair: () => Promise.reject(new Error('Unexpected cancellation')),
  publish: () => Promise.resolve(true),
};
const app = createConvergenceApp({ databaseUrl, queueName, port: () => port });
const worker = await app.startWorker({
  concurrency: 1,
  claimTimeout: 1,
  pollInterval: 0.05,
  fatalOnLeaseTimeout: false,
});
try {
  if (mode === 'initial') await new Promise<never>(() => {});
  const result = await app.awaitTaskResult(taskId, { timeout: 30 });
  process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
} finally {
  await worker.close();
  await app.close();
  await db.end();
}
