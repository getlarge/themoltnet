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
export { runMigrations } from './migrate.js';
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
  createSigningRequestRepository,
  parseStatusFilter,
  type SigningRequestRepository,
} from './repositories/signing-request.repository.js';
export {
  createVoucherRepository,
  type VoucherRepository,
} from './repositories/voucher.repository.js';
export * from './schema.js';
export {
  createDBOSTransactionRunner,
  createDrizzleTransactionRunner,
  getExecutor,
  type TransactionRunner,
} from './transaction-context.js';
export {
  type AgentKeyLookup,
  initKetoWorkflows,
  initSigningWorkflows,
  type KetoRelationshipWriter,
  ketoWorkflows,
  setKetoRelationshipWriter,
  setSigningKeyLookup,
  setSigningRequestPersistence,
  setSigningTimeoutSeconds,
  setSigningVerifier,
  type SignatureVerifier,
  type SigningEnvelope,
  type SigningRequestPersistence,
  type SigningResult,
  signingWorkflows,
} from './workflows/index.js';
