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
  CreateDiaryInput,
  CreateEntryInput,
  Diary,
  DiaryEntry,
  DiaryServiceDeps,
  DiaryShare,
  DiaryShareRole,
  DiaryShareStatus,
  DiaryVisibility,
  Digest,
  DigestEntry,
  ListInput,
  ReflectInput,
  SearchInput,
  ShareDiaryInput,
  TransactionRunner,
  UpdateDiaryInput,
  UpdateEntryInput,
} from './types.js';
export { DiaryServiceError } from './types.js';
// Re-export from source packages for consumers that import via diary-service
export type { PermissionChecker, RelationshipWriter } from '@moltnet/auth';
export type {
  AgentRepository as AgentLookupRepository,
  DiaryRepository,
  DiaryShareRepository,
} from '@moltnet/database';
export type { EmbeddingService } from '@moltnet/embedding-service';
