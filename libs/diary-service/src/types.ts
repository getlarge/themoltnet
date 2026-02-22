/**
 * @moltnet/diary-service — Type Definitions
 */

import type { PermissionChecker, RelationshipWriter } from '@moltnet/auth';
import type {
  AgentRepository,
  DiaryEntryRepository,
  DiaryRepository,
  DiaryShareRepository,
} from '@moltnet/database';
import type { EmbeddingService } from '@moltnet/embedding-service';

export interface DiaryServiceDeps {
  diaryRepository: DiaryRepository;
  diaryEntryRepository: DiaryEntryRepository;
  diaryShareRepository: DiaryShareRepository;
  agentRepository: AgentRepository;
  permissionChecker: PermissionChecker;
  relationshipWriter: RelationshipWriter;
  embeddingService: EmbeddingService;
  /** Runs callbacks inside a database transaction */
  transactionRunner: TransactionRunner;
}

/**
 * Abstraction over transaction execution.
 * Production: createDBOSTransactionRunner (from @moltnet/database)
 * Tests: createDrizzleTransactionRunner or a simple mock
 */
export interface TransactionRunner {
  runInTransaction<T>(
    fn: () => Promise<T>,
    config?: { name?: string },
  ): Promise<T>;
}

export type EntryType =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'reflection'
  | 'identity'
  | 'soul';

export type DiaryVisibility = 'private' | 'moltnet' | 'public';
export type DiaryShareRole = 'reader' | 'writer';
export type DiaryShareStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

// ============================================================================
// Diary Container (catalog) types
// ============================================================================

export interface Diary {
  id: string;
  ownerId: string;
  name: string;
  visibility: DiaryVisibility;
  signed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiaryShare {
  id: string;
  diaryId: string;
  sharedWith: string;
  role: DiaryShareRole;
  status: DiaryShareStatus;
  invitedAt: Date;
  respondedAt: Date | null;
}

// ============================================================================
// Entry types
// ============================================================================

export interface DiaryEntry {
  id: string;
  diaryId: string;
  title: string | null;
  content: string;
  embedding: number[] | null;
  tags: string[] | null;
  injectionRisk: boolean;
  importance: number;
  accessCount: number;
  lastAccessedAt: Date | null;
  entryType: EntryType;
  supersededBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Input types
// ============================================================================

export interface CreateDiaryInput {
  ownerId: string;
  name: string;
  visibility?: DiaryVisibility;
}

export interface UpdateDiaryInput {
  name?: string;
  visibility?: DiaryVisibility;
}

export interface ShareDiaryInput {
  diaryId: string;
  ownerId: string;
  fingerprint: string;
  role?: DiaryShareRole;
}

export interface CreateEntryInput {
  diaryId: string;
  content: string;
  title?: string;
  tags?: string[];
  importance?: number;
  entryType?: EntryType;
}

export interface UpdateEntryInput {
  title?: string;
  content?: string;
  tags?: string[];
  importance?: number;
  entryType?: EntryType;
  supersededBy?: string;
}

export interface SearchInput {
  diaryId?: string;
  query?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  wRelevance?: number;
  wRecency?: number;
  wImportance?: number;
  entryTypes?: EntryType[];
  excludeSuperseded?: boolean;
}

export interface ListInput {
  diaryId: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  entryType?: EntryType;
}

export interface ReflectInput {
  diaryId: string;
  days?: number;
  maxEntries?: number;
  entryTypes?: EntryType[];
}

export interface DigestEntry {
  id: string;
  content: string;
  tags: string[] | null;
  importance: number;
  entryType: EntryType;
  createdAt: Date;
}

export interface Digest {
  entries: DigestEntry[];
  totalEntries: number;
  periodDays: number;
  generatedAt: string;
}

// ============================================================================
// Error
// ============================================================================

export class DiaryServiceError extends Error {
  constructor(
    public readonly code:
      | 'not_found'
      | 'forbidden'
      | 'self_share'
      | 'already_shared'
      | 'wrong_status'
      | 'validation_failed',
    message: string,
  ) {
    super(message);
    this.name = 'DiaryServiceError';
  }
}
