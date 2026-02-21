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
  diaryEntryRepository: DiaryEntryRepository;
  diaryShareRepository: DiaryShareRepository;
  agentRepository: AgentLookupRepository;
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
  /** ID of the requester (used for Keto ownership grant) */
  requesterId: string;
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
  diaryId: string;
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
// Repository interfaces (minimal structural — avoids importing database/auth)
// ============================================================================

export interface DiaryRepository {
  create(input: {
    ownerId: string;
    name: string;
    visibility: DiaryVisibility;
  }): Promise<Diary>;
  findById(id: string): Promise<Diary | null>;
  findOwnedById(ownerId: string, id: string): Promise<Diary | null>;
  listByOwner(ownerId: string): Promise<Diary[]>;
  update(
    id: string,
    ownerId: string,
    updates: { name?: string; visibility?: DiaryVisibility },
  ): Promise<Diary | null>;
  delete(id: string, ownerId: string): Promise<boolean>;
}

export interface DiaryEntryRepository {
  create(entry: {
    id?: string;
    diaryId: string;
    content: string;
    title?: string | null;
    tags?: string[] | null;
    embedding?: number[] | null;
    injectionRisk?: boolean;
    importance?: number;
    entryType?: EntryType;
  }): Promise<DiaryEntry>;
  findById(id: string): Promise<DiaryEntry | null>;
  list(options: ListInput): Promise<DiaryEntry[]>;
  search(options: {
    diaryId: string;
    query?: string;
    embedding?: number[];
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
      tags: string[] | null;
      embedding: number[] | null;
      injectionRisk: boolean;
      importance: number;
      entryType: EntryType;
      supersededBy: string | null;
    }>,
  ): Promise<DiaryEntry | null>;
  delete(id: string): Promise<boolean>;
  getRecentForDigest(
    diaryId: string,
    days?: number,
    limit?: number,
    entryTypes?: EntryType[],
  ): Promise<DiaryEntry[]>;
}

export interface DiaryShareRepository {
  create(input: {
    diaryId: string;
    sharedWith: string;
    role: DiaryShareRole;
  }): Promise<DiaryShare | null>;
  findById(id: string): Promise<DiaryShare | null>;
  findByDiaryAndAgent(
    diaryId: string,
    sharedWith: string,
  ): Promise<DiaryShare | null>;
  listByDiary(diaryId: string): Promise<DiaryShare[]>;
  listPendingForAgent(agentId: string): Promise<DiaryShare[]>;
  updateStatus(
    id: string,
    status: DiaryShareStatus,
    updates?: { respondedAt?: Date | null; role?: DiaryShareRole },
  ): Promise<DiaryShare | null>;
}

export interface AgentLookupRepository {
  findByFingerprint(
    fingerprint: string,
  ): Promise<{ identityId: string } | null>;
}

export interface PermissionChecker {
  canViewEntry(entryId: string, agentId: string): Promise<boolean>;
  canEditEntry(entryId: string, agentId: string): Promise<boolean>;
  canDeleteEntry(entryId: string, agentId: string): Promise<boolean>;
  canReadDiary(diaryId: string, agentId: string): Promise<boolean>;
  canWriteDiary(diaryId: string, agentId: string): Promise<boolean>;
  canManageDiary(diaryId: string, agentId: string): Promise<boolean>;
}

export interface RelationshipWriter {
  grantOwnership(entryId: string, agentId: string): Promise<void>;
  registerAgent(agentId: string): Promise<void>;
  removeEntryRelations(entryId: string): Promise<void>;
  grantDiaryOwner(diaryId: string, agentId: string): Promise<void>;
  grantDiaryWriter(diaryId: string, agentId: string): Promise<void>;
  grantDiaryReader(diaryId: string, agentId: string): Promise<void>;
  removeDiaryRelations(diaryId: string): Promise<void>;
  removeDiaryRelationForAgent(diaryId: string, agentId: string): Promise<void>;
}

// ============================================================================
// Error
// ============================================================================

export class DiaryServiceError extends Error {
  constructor(
    public readonly code:
      | 'not_found'
      | 'self_share'
      | 'already_shared'
      | 'wrong_status',
    message: string,
  ) {
    super(message);
    this.name = 'DiaryServiceError';
  }
}
