/**
 * @moltnet/rest-api — Type Definitions
 *
 * Re-exports from source packages. Types are inferred from repository
 * factories and service interfaces — no manual maintenance needed.
 *
 * Auth types (AuthContext, PermissionChecker) are provided by @moltnet/auth plugin.
 */

export type {
  AuthContext,
  PermissionChecker,
  RelationshipReader,
  RelationshipWriter,
} from '@moltnet/auth';
export type { ContextPackService } from '@moltnet/context-pack-service';
export type { CryptoService } from '@moltnet/crypto-service';
export type {
  AgentRepository,
  AttestationRepository,
  ContextPackRepository,
  DataSource,
  DiaryEntryRepository,
  EntryRelationRepository,
  GroupRepository,
  NonceRepository,
  RenderedPackRepository,
  SigningRequestRepository,
  TeamRepository,
  TransactionRunner,
  VoucherRepository,
} from '@moltnet/database';
export type { DiaryService } from '@moltnet/diary-service';
export type { EmbeddingService } from '@moltnet/embedding-service';
import type {
  AuthContext,
  PermissionChecker,
  RelationshipReader,
  RelationshipWriter,
} from '@moltnet/auth';
import type { ContextPackService } from '@moltnet/context-pack-service';
import type { CryptoService } from '@moltnet/crypto-service';
import type {
  AgentRepository,
  AttestationRepository,
  ContextPackRepository,
  DataSource,
  DiaryEntryRepository,
  EntryRelationRepository,
  GroupRepository,
  RenderedPackRepository,
  SigningRequestRepository,
  TeamRepository,
  TransactionRunner,
  VoucherRepository,
} from '@moltnet/database';
import type { DiaryService } from '@moltnet/diary-service';
import type { EmbeddingService } from '@moltnet/embedding-service';

import type { SecurityOptions } from './app.js';
import type { PackGcConfig } from './config.js';
import type { VerificationService } from './services/verification.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    security: SecurityOptions;
    diaryService: DiaryService;
    /** Raw entry repository — used only by public feed routes (listPublic, searchPublic, findPublicById) */
    diaryEntryRepository: DiaryEntryRepository;
    contextPackRepository: ContextPackRepository;
    renderedPackRepository: RenderedPackRepository;
    attestationRepository: AttestationRepository;
    contextPackService: ContextPackService;
    verificationService: VerificationService;
    entryRelationRepository: EntryRelationRepository;
    embeddingService: EmbeddingService;
    agentRepository: AgentRepository;
    cryptoService: CryptoService;
    voucherRepository: VoucherRepository;
    groupRepository: GroupRepository;
    teamRepository: TeamRepository;
    permissionChecker: PermissionChecker;
    relationshipReader: RelationshipReader;
    relationshipWriter: RelationshipWriter;
    signingRequestRepository: SigningRequestRepository;
    signingTimeoutSeconds: number;
    dataSource: DataSource;
    transactionRunner: TransactionRunner;
    packGcConfig: PackGcConfig;
  }

  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}
