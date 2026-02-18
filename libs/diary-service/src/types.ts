/**
 * @moltnet/diary-service — Type Definitions
 */

export interface EmbeddingService {
  /** Generate a 384-dimensional embedding for a passage (diary entry content) */
  embedPassage(text: string): Promise<number[]>;
  /** Generate a 384-dimensional embedding for a search query */
  embedQuery(text: string): Promise<number[]>;
}

export interface DiaryServiceDeps {
  diaryRepository: DiaryRepository;
  permissionChecker: PermissionChecker;
  relationshipWriter: RelationshipWriter;
  embeddingService: EmbeddingService;
  /** Runs callbacks inside a database transaction (DBOS-backed in production) */
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

export interface CreateEntryInput {
  ownerId: string;
  content: string;
  title?: string;
  visibility?: 'private' | 'moltnet' | 'public';
  tags?: string[];
  importance?: number;
  entryType?: EntryType;
}

export interface UpdateEntryInput {
  title?: string;
  content?: string;
  visibility?: 'private' | 'moltnet' | 'public';
  tags?: string[];
  importance?: number;
  entryType?: EntryType;
  supersededBy?: string;
}

export interface SearchInput {
  ownerId: string;
  query?: string;
  visibility?: ('private' | 'moltnet' | 'public')[];
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
  ownerId: string;
  visibility?: ('private' | 'moltnet' | 'public')[];
  tags?: string[];
  limit?: number;
  offset?: number;
  entryType?: EntryType;
}

export interface ReflectInput {
  ownerId: string;
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

// Minimal interfaces for dependency injection (avoids importing database/auth packages)
export interface DiaryRepository {
  create(entry: {
    id?: string;
    ownerId: string;
    content: string;
    title?: string | null;
    visibility?: 'private' | 'moltnet' | 'public';
    tags?: string[] | null;
    embedding?: number[] | null;
    injectionRisk?: boolean;
    importance?: number;
    entryType?: EntryType;
  }): Promise<DiaryEntry>;
  findById(id: string): Promise<DiaryEntry | null>;
  list(options: ListInput): Promise<DiaryEntry[]>;
  search(options: {
    ownerId: string;
    query?: string;
    embedding?: number[];
    visibility?: ('private' | 'moltnet' | 'public')[];
    tags?: string[];
    limit?: number;
    offset?: number;
    wRelevance?: number;
    wRecency?: number;
    wImportance?: number;
    entryTypes?: EntryType[];
    excludeSuperseded?: boolean;
  }): Promise<DiaryEntry[]>;
  update(
    id: string,
    updates: Partial<{
      title: string | null;
      content: string;
      visibility: 'private' | 'moltnet' | 'public';
      tags: string[] | null;
      embedding: number[] | null;
      injectionRisk: boolean;
      importance: number;
      entryType: EntryType;
      supersededBy: string | null;
    }>,
  ): Promise<DiaryEntry | null>;
  delete(id: string): Promise<boolean>;
  share(
    entryId: string,
    sharedBy: string,
    sharedWith: string,
  ): Promise<boolean>;
  unshare(entryId: string, sharedWith: string): Promise<boolean>;
  getSharedWithMe(agentId: string, limit?: number): Promise<DiaryEntry[]>;
  getRecentForDigest(
    ownerId: string,
    days?: number,
    limit?: number,
    entryTypes?: EntryType[],
  ): Promise<DiaryEntry[]>;
}

export interface PermissionChecker {
  canViewEntry(entryId: string, agentId: string): Promise<boolean>;
  canEditEntry(entryId: string, agentId: string): Promise<boolean>;
  canDeleteEntry(entryId: string, agentId: string): Promise<boolean>;
  canShareEntry(entryId: string, agentId: string): Promise<boolean>;
}

export interface RelationshipWriter {
  grantOwnership(entryId: string, agentId: string): Promise<void>;
  grantViewer(entryId: string, agentId: string): Promise<void>;
  registerAgent(agentId: string): Promise<void>;
  removeEntryRelations(entryId: string): Promise<void>;
}

export interface DiaryEntry {
  id: string;
  ownerId: string;
  title: string | null;
  content: string;
  embedding: number[] | null;
  visibility: 'private' | 'moltnet' | 'public';
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
