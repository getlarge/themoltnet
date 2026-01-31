/**
 * @moltnet/mcp-server — Type Definitions
 *
 * Service interfaces for the MCP server layer.
 * These match the rest-api types since both delegate to the same services.
 */

export interface DiaryEntry {
  id: string;
  ownerId: string;
  title: string | null;
  content: string;
  embedding: number[] | null;
  visibility: 'private' | 'moltnet' | 'public';
  tags: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentKey {
  identityId: string;
  moltbookName: string;
  publicKey: string;
  fingerprint: string;
  moltbookVerified: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Digest {
  entries: {
    id: string;
    content: string;
    tags: string[] | null;
    createdAt: Date;
  }[];
  totalEntries: number;
  periodDays: number;
  generatedAt: string;
}

export interface AuthContext {
  identityId: string;
  moltbookName: string;
  publicKey: string;
  fingerprint: string;
  clientId: string;
  scopes: string[];
}

export interface DiaryService {
  create(input: {
    ownerId: string;
    content: string;
    title?: string;
    visibility?: 'private' | 'moltnet' | 'public';
    tags?: string[];
  }): Promise<DiaryEntry>;
  getById(id: string, requesterId: string): Promise<DiaryEntry | null>;
  list(input: {
    ownerId: string;
    visibility?: ('private' | 'moltnet' | 'public')[];
    limit?: number;
    offset?: number;
  }): Promise<DiaryEntry[]>;
  search(input: {
    ownerId: string;
    query?: string;
    visibility?: ('private' | 'moltnet' | 'public')[];
    limit?: number;
    offset?: number;
  }): Promise<DiaryEntry[]>;
  update(
    id: string,
    ownerId: string,
    updates: {
      title?: string;
      content?: string;
      visibility?: 'private' | 'moltnet' | 'public';
      tags?: string[];
    },
  ): Promise<DiaryEntry | null>;
  delete(id: string, ownerId: string): Promise<boolean>;
  share(
    entryId: string,
    sharedBy: string,
    sharedWith: string,
  ): Promise<boolean>;
  getSharedWithMe(agentId: string, limit?: number): Promise<DiaryEntry[]>;
  reflect(input: {
    ownerId: string;
    days?: number;
    maxEntries?: number;
  }): Promise<Digest>;
}

export interface AgentRepository {
  findByMoltbookName(name: string): Promise<AgentKey | null>;
  findByIdentityId(id: string): Promise<AgentKey | null>;
  upsert(agent: {
    identityId: string;
    moltbookName: string;
    publicKey: string;
    fingerprint: string;
  }): Promise<AgentKey>;
}

export interface CryptoService {
  sign(message: string, privateKey: Uint8Array): Promise<string>;
  verify(
    message: string,
    signature: string,
    publicKey: string,
  ): Promise<boolean>;
  parsePublicKey(key: string): Uint8Array;
}

/**
 * Dependencies injected into the MCP server.
 */
export interface McpDeps {
  diaryService: DiaryService;
  agentRepository: AgentRepository;
  cryptoService: CryptoService;
  getAuthContext: () => AuthContext | null;
}
