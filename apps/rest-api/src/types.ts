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
  DataSource,
  DiaryRepository as DiaryCatalogRepository,
  DiaryEntryRepository as DiaryRepository,
  NonceRepository,
  SigningRequestRepository,
  TransactionRunner,
  VoucherRepository,
} from '@moltnet/database';
export type { DiaryService, EmbeddingService } from '@moltnet/diary-service';

import type { CryptoService } from '@moltnet/crypto-service';
import type {
  AgentRepository,
  DataSource,
  DiaryEntryRepository as DiaryRepository,
  DiaryRepository as DiaryCatalogRepository,
  SigningRequestRepository,
  TransactionRunner,
  VoucherRepository,
} from '@moltnet/database';
import type { DiaryService, EmbeddingService } from '@moltnet/diary-service';

declare module 'fastify' {
  interface FastifyInstance {
    diaryService: DiaryService;
    embeddingService: EmbeddingService;
    diaryCatalogRepository: DiaryCatalogRepository;
    diaryRepository: DiaryRepository;
    agentRepository: AgentRepository;
    cryptoService: CryptoService;
    voucherRepository: VoucherRepository;
    signingRequestRepository: SigningRequestRepository;
    signingTimeoutSeconds: number;
    dataSource: DataSource;
    transactionRunner: TransactionRunner;
  }
}
