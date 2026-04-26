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
  DBOSErrors,
  type DrizzleDataSource,
  getDataSource,
  initDBOS,
  isDBOSReady,
  launchDBOS,
  shutdownDBOS,
  type WorkflowHandle,
  WorkflowQueue,
} from './dbos.js';
export { runMigrations } from './migrate.js';
export {
  type AgentRepository,
  createAgentRepository,
} from './repositories/agent.repository.js';
export {
  type ContextPackRepository,
  type ContextPackWithCreator,
  createContextPackRepository,
  type ExpandedPackEntry,
  type PackDiffCompressionLevel,
  type PackDiffRow,
} from './repositories/context-pack.repository.js';
export {
  createDiaryRepository,
  type DiaryRepository,
} from './repositories/diary.repository.js';
export {
  createDiaryEntryRepository,
  type DiaryEntryRepository,
  type DiaryListOptions,
  type DiarySearchOptions,
  type DiaryTagCount,
  type DiaryTagsOptions,
  type ListPublicSinceOptions,
  type PublicFeedCursor,
  type PublicFeedEntry,
  type PublicFeedOptions,
  type PublicSearchOptions,
  type PublicSearchResult,
} from './repositories/diary-entry.repository.js';
export {
  type CreateDiaryTransferInput,
  createDiaryTransferRepository,
  type DiaryTransferRepository,
} from './repositories/diary-transfer.repository.js';
export {
  createEntryRelationRepository,
  type EntryRelationRepository,
  type RelationAtDepth,
} from './repositories/entry-relation.repository.js';
export {
  type CreateGroupInput,
  createGroupRepository,
  type GroupRepository,
} from './repositories/group.repository.js';
export {
  createHumanRepository,
  type HumanRepository,
} from './repositories/human.repository.js';
export {
  createNonceRepository,
  type NonceRepository,
} from './repositories/nonce.repository.js';
export {
  createRenderedPackRepository,
  type RenderedPackRepository,
} from './repositories/rendered-pack.repository.js';
export {
  createSigningRequestRepository,
  parseStatusFilter,
  type SigningRequestRepository,
} from './repositories/signing-request.repository.js';
export {
  createTaskRepository,
  type TaskRepository,
} from './repositories/task.repository.js';
export {
  type CreateFoundingAcceptanceInput,
  type CreateInviteInput,
  type CreateTeamInput,
  createTeamRepository,
  type TeamRepository,
} from './repositories/team.repository.js';
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
  _resetTaskWorkflowsForTesting,
  type AgentKeyLookup,
  initSigningWorkflows,
  initTaskWorkflows,
  setSigningKeyLookup,
  setSigningRequestPersistence,
  setSigningTimeoutSeconds,
  setSigningVerifier,
  setTaskWorkflowDeps,
  type SignatureVerifier,
  type SigningEnvelope,
  type SigningRequestPersistence,
  type SigningResult,
  signingWorkflows,
  type TaskAttemptClaimedEvent,
  type TaskAttemptFinalEvent,
  TaskWorkflowConfigurationError,
  type TaskWorkflowDeps,
  taskWorkflows,
} from './workflows/index.js';
