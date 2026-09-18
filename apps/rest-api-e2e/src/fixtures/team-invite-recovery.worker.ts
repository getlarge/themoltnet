/* eslint-disable @nx/enforce-module-boundaries -- Process fixture exercises the server workflow directly. */
/** Process fixture for real DBOS/Keto recovery tests; never imported by the server. */
import {
  createOryClients,
  createRelationshipReader,
  createRelationshipWriter,
} from '@moltnet/auth';
import {
  configureDBOS,
  createDatabase,
  createDBOSTransactionRunner,
  createTeamRepository,
  getDataSource,
  initDBOS,
  launchDBOS,
  shutdownDBOS,
} from '@moltnet/database';

import {
  initTeamInviteWorkflow,
  type RedeemTeamInvite,
  setTeamInviteDeps,
  teamInviteWorkflow,
} from '../../../rest-api/src/workflows/team-invite-workflow.js';
import { startInviteHttpServer } from './invite-http-server.js';

async function main(): Promise<void> {
  const databaseUrl = process.env.INVITE_TEST_DATABASE_URL!;
  const input = JSON.parse(process.env.INVITE_TEST_INPUT!) as RedeemTeamInvite;
  const pauseAt = process.env.INVITE_TEST_PAUSE;
  async function pause(point: string): Promise<void> {
    if (pauseAt !== point) return;
    console.log(`PAUSED:${point}`);
    await new Promise<void>(() => {});
  }

  const connection = createDatabase(databaseUrl);
  configureDBOS(databaseUrl, false, 'error');
  initTeamInviteWorkflow();
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
  setTeamInviteDeps({
    teamRepository: createTeamRepository(connection.db),
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
          if (pauseAt === 'rollback' && config?.name === 'team.invite.claim') {
            throw new Error('injected invite transaction rollback');
          }
          return value;
        }, config);
        if (config?.name === 'team.invite.claim') await pause('claim');
        return result;
      },
    },
  });
  await launchDBOS();
  if (process.env.INVITE_TEST_HTTP === '1') {
    const url = await startInviteHttpServer(
      input,
      createTeamRepository(connection.db),
      createRelationshipReader(clients.relationshipRead),
      writer,
    );
    console.log(`HTTP:${url}`);
    await new Promise<void>(() => {});
  }
  try {
    const results = await Promise.all([
      teamInviteWorkflow.run(input),
      teamInviteWorkflow.run(input),
    ]);
    const mismatch = await teamInviteWorkflow
      .run({ ...input, subjectId: '11111111-1111-4111-8111-111111111111' })
      .then(
        () => false,
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'INVITE_EXHAUSTED',
      );
    console.log(
      `RESULT:${JSON.stringify({ teams: results.map((r) => r.teamId), role: results[0].role, mismatch })}`,
    );
  } finally {
    await shutdownDBOS();
    await connection.pool.end();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
