/**
 * @moltnet/rest-api — Type Definitions
 *
 * Re-exports from source packages. Types are inferred from repository
 * factories and service interfaces — no manual maintenance needed.
 *
 * Auth types (AuthContext, PermissionChecker) are provided by @moltnet/auth plugin.
 */

export type { CryptoService } from '@moltnet/crypto-service';
export type {
  AgentRepository,
  ContextPackRepository,
  DataSource,
  DiaryEntryRepository,
  EntryRelationRepository,
  NonceRepository,
  SigningRequestRepository,
  TransactionRunner,
  VoucherRepository,
} from '@moltnet/database';
export type { DiaryService } from '@moltnet/diary-service';
export type { EmbeddingService } from '@moltnet/embedding-service';
import type { CryptoService } from '@moltnet/crypto-service';
import type {
  AgentRepository,
  ContextPackRepository,
  DataSource,
  DiaryEntryRepository,
  EntryRelationRepository,
  SigningRequestRepository,
  TransactionRunner,
  VoucherRepository,
} from '@moltnet/database';
import type { DiaryService, EmbeddingService } from '@moltnet/diary-service';

import type { SecurityOptions } from './app.js';
import type { PackGcConfig } from './config.js';

declare module 'fastify' {
  interface FastifyInstance {
    security: SecurityOptions;
    diaryService: DiaryService;
    /** Raw entry repository — used only by public feed routes (listPublic, searchPublic, findPublicById) */
    diaryEntryRepository: DiaryEntryRepository;
    contextPackRepository: ContextPackRepository;
    entryRelationRepository: EntryRelationRepository;
    embeddingService: EmbeddingService;
    agentRepository: AgentRepository;
    cryptoService: CryptoService;
    voucherRepository: VoucherRepository;
    signingRequestRepository: SigningRequestRepository;
    signingTimeoutSeconds: number;
    dataSource: DataSource;
    transactionRunner: TransactionRunner;
    packGcConfig: PackGcConfig;
  }
}
