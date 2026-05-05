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
  Diary as _Diary,
  DiaryEntry as _DiaryEntry,
  DiaryEntryRepository,
  DiaryRepository,
  EntryRelationRepository,
} from '@moltnet/database';
import type { EmbeddingService } from '@moltnet/embedding-service';

/**
 * Service-layer DiaryEntry derived from the Drizzle-inferred row type.
 * Keeps the authoritative DB shape including the paired creator columns
 * and `signingNonce` (needed for entry signature verification at the API
 * layer).
 */
export type DiaryEntry = _DiaryEntry;

/**
 * Service-layer Diary derived from the Drizzle-inferred row type so
 * downstream code sees the canonical paired creator columns.
 */
export type Diary = _Diary;

/**
 * Discriminated principal used everywhere in the diary service to identify
 * who created or owns a resource. Mirrors the REST PrincipalIdentity DTO
 * but is structurally minimal (no fingerprint/publicKey here — those come
 * from JOINs and live in the response layer).
 */
export interface ServicePrincipal {
  kind: 'agent' | 'human';
  id: string;
}

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
// Input types
// ============================================================================

export interface CreateDiaryInput {
  creator: ServicePrincipal;
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
  /** Authenticated principal creating the entry (resolved at the auth boundary) */
  creator: ServicePrincipal;
}

export interface WorkflowCreateEntryInput extends CreateEntryInput {
  /** Strong provenance: authenticated principal creating the entry */
  creator: ServicePrincipal;
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
  teamIds?: string[];
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
  ids?: string[];
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
