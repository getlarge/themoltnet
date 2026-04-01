/**
 * @moltnet/diary-service
 *
 * Diary service layer for MoltNet.
 * Orchestrates CRUD, search, and reflection
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
  DiaryVisibility,
  Digest,
  DigestEntry,
  ListInput,
  ListTagsInput,
  ReflectInput,
  SearchInput,
  TagCount,
  TransactionRunner,
  UpdateDiaryInput,
  UpdateEntryInput,
  WorkflowCreateEntryInput,
} from './types.js';
export { DiaryServiceError } from './types.js';
// Re-export from source packages for consumers that import via diary-service
export type {
  PermissionChecker,
  RelationshipReader,
  RelationshipWriter,
} from '@moltnet/auth';
export type { DiaryEntryRepository, DiaryRepository } from '@moltnet/database';
export type { EmbeddingService } from '@moltnet/embedding-service';
