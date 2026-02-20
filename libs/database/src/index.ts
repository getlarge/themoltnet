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
  type DiaryRepository,
} from './repositories/diary.repository.js';
export {
  createDiaryEntryRepository,
  type DiaryEntryRepository,
  type DiaryListOptions,
  type DiarySearchOptions,
  type ListPublicSinceOptions,
  type PublicFeedCursor,
  type PublicFeedEntry,
  type PublicFeedOptions,
  type PublicSearchOptions,
  type PublicSearchResult,
} from './repositories/diary-entry.repository.js';
export {
  createDiaryShareRepository,
  type DiaryShareRepository,
} from './repositories/diary-share.repository.js';
export {
  createNonceRepository,
  type NonceRepository,
} from './repositories/nonce.repository.js';
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
  initSigningWorkflows,
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
