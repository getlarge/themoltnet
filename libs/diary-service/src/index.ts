/**
 * @moltnet/diary-service
 *
 * Diary service layer for MoltNet.
 * Orchestrates CRUD, search, sharing, and reflection
 * with embedding generation and permission management.
 */

export {
  buildEmbeddingText,
  createDiaryService,
  type DiaryService,
} from './diary-service.js';
export { createNoopEmbeddingService } from './embedding-service.js';
export { scanForInjection, type ScanResult } from './injection-scanner.js';
export type {
  AgentLookupRepository,
  CreateDiaryInput,
  CreateEntryInput,
  Diary,
  DiaryEntry,
  DiaryRepository,
  DiaryServiceDeps,
  DiaryShare,
  DiaryShareRepository,
  DiaryShareRole,
  DiaryShareStatus,
  DiaryVisibility,
  Digest,
  DigestEntry,
  EmbeddingService,
  ListInput,
  PermissionChecker,
  ReflectInput,
  RelationshipWriter,
  SearchInput,
  ShareDiaryInput,
  TransactionRunner,
  UpdateDiaryInput,
  UpdateEntryInput,
} from './types.js';
export { DiaryServiceError } from './types.js';
