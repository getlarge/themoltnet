// A replaceable process for testing the actual DBOS crash/recovery boundary.
import {
  configureDBOS,
  createDatabase,
  createDBOSTransactionRunner,
  createDiaryEntryRepository,
  DBOS,
  getDataSource,
  initDBOS,
  launchDBOS,
} from '@moltnet/database';

import type { RelationshipWriter } from '../../src/index.js';
import {
  diaryWorkflows,
  initDiaryWorkflows,
  registerDiaryEmbeddingQueue,
  setDiaryWorkflowDeps,
} from '../../src/workflows/diary-workflows.js';

const databaseUrl = process.env.RECOVERY_DATABASE_URL!;
const { db, pool } = createDatabase(databaseUrl);
configureDBOS(databaseUrl, false, 'error');
initDiaryWorkflows();
await initDBOS({ databaseUrl, systemDatabaseUrl: databaseUrl });
const pause = () => new Promise<never>(() => {});
setDiaryWorkflowDeps({
  diaryEntryRepository: createDiaryEntryRepository(db),
  transactionRunner: createDBOSTransactionRunner(getDataSource()),
  relationshipWriter: {
    async grantEntryParent(id: string) {
      await pool.query(
        `INSERT INTO recovery_effects(kind, id) VALUES ('relation', $1) ON CONFLICT DO NOTHING`,
        [id],
      );
      if (process.env.RECOVERY_HOLD === 'relation') {
        process.send?.('relation');
        await pause();
      }
    },
  } as unknown as RelationshipWriter,
  embeddingService: {
    async embedPassage() {
      await pool.query(
        `INSERT INTO recovery_effects(kind, id) VALUES ('inference', 'attempt') ON CONFLICT DO NOTHING`,
      );
      if (process.env.RECOVERY_HOLD === 'inference') {
        process.send?.('inference');
        await pause();
      }
      if (process.env.RECOVERY_HOLD === 'failure')
        throw new Error('temporary inference failure');
      return Array(384).fill(0.125);
    },
    async embedQuery() {
      return [];
    },
  },
});
await launchDBOS();
await registerDiaryEmbeddingQueue(1);
await DBOS.withNextWorkflowID(
  `recovery-create-${process.env.RECOVERY_CASE}`,
  () =>
    diaryWorkflows.createEntry({
      diaryId: process.env.RECOVERY_DIARY_ID!,
      creator: { kind: 'agent', id: process.env.RECOVERY_AGENT_ID! },
      content: 'Recover background embedding',
      contentHash: 'recovery-test-cid',
    }),
);
process.send?.('created');
