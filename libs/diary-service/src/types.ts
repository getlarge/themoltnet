/**
 * @moltnet/diary-service — Type Definitions
 */

import type { KetoNamespace } from '@moltnet/auth';
import {
  type PermissionChecker,
  type RelationshipReader,
  type RelationshipWriter,
} from '@moltnet/auth';
import type {
  DiaryEntryRepository,
  DiaryRepository,
  EntryRelationRepository,
} from '@moltnet/database';
import type { EmbeddingService } from '@moltnet/embedding-service';

/**
 * Minimal structured logger interface — framework-agnostic.
 * Structurally compatible with FastifyBaseLogger, pino.Logger, etc.
 */
export interface Logger {
  info(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface DiaryServiceDeps {
  logger: Logger;
  diaryRepository: DiaryRepository;
  diaryEntryRepository: DiaryEntryRepository;
  entryRelationRepository: EntryRelationRepository;
  permissionChecker: PermissionChecker;
  relationshipReader: RelationshipReader;
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
// ============================================================================
// Diary Container (catalog) types
// ============================================================================

export interface Diary {
  id: string;
  createdBy: string;
  teamId: string;
  name: string;
  visibility: DiaryVisibility;
  signed: boolean;
  createdAt: Date;
  updatedAt: Date;
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
  contentHash: string | null;
  contentSignature: string | null;
  signingNonce: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Input types
// ============================================================================

export interface CreateDiaryInput {
  createdBy: string;
  name: string;
  visibility?: DiaryVisibility;
  teamId: string;
  subjectNs?: KetoNamespace;
}

export interface UpdateDiaryInput {
  name?: string;
  visibility?: DiaryVisibility;
}

export interface CreateEntryInput {
  diaryId: string;
  content: string;
  title?: string;
  tags?: string[];
  importance?: number;
  entryType?: EntryType;
  /** CIDv1 content hash (provided by agent, verified by server) */
  contentHash?: string;
  /** Resolved Ed25519 signature from signing request (set by API layer) */
  contentSignature?: string;
  /** Nonce from signing request (stored for self-contained verification) */
  signingNonce?: string;
}

export interface WorkflowCreateEntryInput extends CreateEntryInput {
  /** Strong provenance: authenticated principal creating the entry */
  createdBy: string;
  /** Service layer precomputes and validates the CID before entering DBOS */
  contentHash: string;
}

export interface UpdateEntryInput {
  title?: string;
  content?: string;
  tags?: string[];
  importance?: number;
  entryType?: EntryType;
  /** Recomputed CIDv1 content hash (set by service on unsigned entry updates) */
  contentHash?: string;
}

export interface SearchInput {
  diaryId?: string;
  diaryIds?: string[];
  query?: string;
  tags?: string[];
  excludeTags?: string[];
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
  excludeTags?: string[];
  limit?: number;
  offset?: number;
  entryTypes?: EntryType[];
}

export interface ListTagsInput {
  diaryId: string;
  prefix?: string;
  minCount?: number;
  entryTypes?: EntryType[];
}

export interface TagCount {
  tag: string;
  count: number;
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
      | 'wrong_status'
      | 'validation_failed'
      | 'immutable',
    message: string,
  ) {
    super(message);
    this.name = 'DiaryServiceError';
  }
}
