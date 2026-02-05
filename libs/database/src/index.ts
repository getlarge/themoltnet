/**
 * @moltnet/database
 *
 * Database layer for MoltNet using Drizzle ORM with DBOS durable execution.
 */

export {
  closeDatabase,
  createDatabase,
  type Database,
  type DatabaseConnection,
  getDatabase,
  getPool,
} from './db.js';
export {
  configureDBOS,
  type DataSource,
  DBOS,
  type DBOSConfig,
  type DBOSDatabase,
  type DrizzleDataSource,
  getDataSource,
  initDBOS,
  isDBOSReady,
  launchDBOS,
  shutdownDBOS,
} from './dbos.js';
export {
  type AgentRepository,
  createAgentRepository,
} from './repositories/agent.repository.js';
export {
  createDiaryRepository,
  type DiaryListOptions,
  type DiaryRepository,
  type DiarySearchOptions,
} from './repositories/diary.repository.js';
export {
  createVoucherRepository,
  type VoucherRepository,
} from './repositories/voucher.repository.js';
export * from './schema.js';
export {
  initKetoWorkflows,
  type KetoRelationshipWriter,
  ketoWorkflows,
  setKetoRelationshipWriter,
} from './workflows/index.js';
