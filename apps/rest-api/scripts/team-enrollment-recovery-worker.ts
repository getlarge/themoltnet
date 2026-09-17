/** Process fixture for real DBOS/Keto recovery tests; never imported by the server. */
import {
  createOryClients,
  createRelationshipReader,
  createRelationshipWriter,
} from '@moltnet/auth';
import {
  type ClaimTeamEnrollment,
  configureDBOS,
  createDatabase,
  createDBOSTransactionRunner,
  createTeamEnrollmentRepository,
  getDataSource,
  initDBOS,
  launchDBOS,
  shutdownDBOS,
} from '@moltnet/database';

import {
  initTeamEnrollmentWorkflow,
  setTeamEnrollmentDeps,
  teamEnrollmentWorkflow,
} from '../src/workflows/team-enrollment-workflow.js';

const databaseUrl = process.env.ENROLLMENT_TEST_DATABASE_URL!;
const input = JSON.parse(
  process.env.ENROLLMENT_TEST_INPUT!,
) as ClaimTeamEnrollment;
const pauseAt = process.env.ENROLLMENT_TEST_PAUSE;
async function pause(point: string): Promise<void> {
  if (pauseAt !== point) return;
  console.log(`PAUSED:${point}`);
  await new Promise<void>(() => {});
}

const connection = createDatabase(databaseUrl);
configureDBOS(databaseUrl, false, 'error');
initTeamEnrollmentWorkflow();
await initDBOS({ databaseUrl, systemDatabaseUrl: databaseUrl });
const transactions = createDBOSTransactionRunner(getDataSource());
const clients = createOryClients({
  baseUrl: 'http://localhost:4445',
  ketoReadUrl: process.env.ORY_KETO_PUBLIC_URL ?? 'http://localhost:4466',
  ketoWriteUrl: process.env.ORY_KETO_ADMIN_URL ?? 'http://localhost:4467',
});
const writer = createRelationshipWriter(
  clients.relationship,
  clients.relationshipRead,
);
setTeamEnrollmentDeps({
  repository: createTeamEnrollmentRepository(connection.db),
  relationshipReader: createRelationshipReader(clients.relationshipRead),
  relationshipWriter: {
    ...writer,
    async grantTeamMembers(...args) {
      await writer.grantTeamMembers(...args);
      console.log('GRANTED');
      await pause('membership');
    },
  },
  transactionRunner: {
    async runInTransaction(fn, config) {
      const result = await transactions.runInTransaction(async () => {
        const value = await fn();
        if (
          pauseAt === 'rollback' &&
          config?.name === 'team.enrollment.claim'
        ) {
          throw new Error('injected enrollment transaction rollback');
        }
        return value;
      }, config);
      if (config?.name === 'team.enrollment.claim') await pause('claim');
      return result;
    },
  },
});
await launchDBOS();
try {
  const receipts = await Promise.all([
    teamEnrollmentWorkflow.run(input),
    teamEnrollmentWorkflow.run(input),
  ]);
  const mismatch = await teamEnrollmentWorkflow
    .run({ ...input, requestHash: 'c'.repeat(64) })
    .then(
      () => false,
      (error: unknown) =>
        error instanceof Error && error.message.includes('conflict'),
    );
  console.log(
    `RESULT:${JSON.stringify({ ids: receipts.map((r) => r.id), role: receipts[0].role, mismatch })}`,
  );
} finally {
  await shutdownDBOS();
  await connection.pool.end();
}
