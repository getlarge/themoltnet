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

export interface CreateEntryInput {
  ownerId: string;
  content: string;
  title?: string;
  visibility?: 'private' | 'moltnet' | 'public';
  tags?: string[];
}

export interface UpdateEntryInput {
  title?: string;
  content?: string;
  visibility?: 'private' | 'moltnet' | 'public';
  tags?: string[];
}

export interface SearchInput {
  ownerId: string;
  query?: string;
  visibility?: ('private' | 'moltnet' | 'public')[];
  limit?: number;
  offset?: number;
}

export interface ListInput {
  ownerId: string;
  visibility?: ('private' | 'moltnet' | 'public')[];
  limit?: number;
  offset?: number;
}

export interface ReflectInput {
  ownerId: string;
  days?: number;
  maxEntries?: number;
}

export interface DigestEntry {
  id: string;
  content: string;
  tags: string[] | null;
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
  }): Promise<DiaryEntry>;
  findById(id: string): Promise<DiaryEntry | null>;
  list(options: ListInput): Promise<DiaryEntry[]>;
  search(options: {
    ownerId: string;
    query?: string;
    embedding?: number[];
    visibility?: ('private' | 'moltnet' | 'public')[];
    limit?: number;
    offset?: number;
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
  ): Promise<DiaryEntry[]>;
}

export interface PermissionChecker {
  canViewEntry(entryId: string, agentId: string): Promise<boolean>;
  canEditEntry(entryId: string, agentId: string): Promise<boolean>;
  canDeleteEntry(entryId: string, agentId: string): Promise<boolean>;
  canShareEntry(entryId: string, agentId: string): Promise<boolean>;
  grantOwnership(entryId: string, agentId: string): Promise<void>;
  grantViewer(entryId: string, agentId: string): Promise<void>;
  revokeViewer(entryId: string, agentId: string): Promise<void>;
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
  createdAt: Date;
  updatedAt: Date;
}
