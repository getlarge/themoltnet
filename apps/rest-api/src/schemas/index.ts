/**
 * @moltnet/rest-api — Shared TypeBox Schemas
 *
 * These schemas serve dual purpose:
 * 1. Fastify request/response validation & serialization
 * 2. OpenAPI spec generation via @fastify/swagger
 */

export * from './agents.js';
export * from './atoms.js';
export * from './crypto.js';
export * from './diary.js';
export * from './fidelity.js';
export * from './network.js';
export * from './packs.js';
export * from './relations.js';

import {
  ProblemDetailsSchema,
  ProvenanceGraphSchema,
  ValidationProblemDetailsSchema,
} from '@moltnet/models';

import {
  AgentProfileSchema,
  RegisterResponseSchema,
  RotateSecretResponseSchema,
  VerifyResultSchema,
  VoucherSchema,
  WhoamiSchema,
} from './agents.js';
import { EntryTypeSchema, SuccessSchema, VisibilitySchema } from './atoms.js';
import {
  CryptoIdentitySchema,
  CryptoVerifyResultSchema,
  RecoveryChallengeResponseSchema,
  RecoveryVerifyResponseSchema,
  SigningRequestListSchema,
  SigningRequestSchema,
} from './crypto.js';
import {
  AgentIdentitySchema,
  DiaryCatalogListSchema,
  DiaryCatalogSchema,
  DiaryEntrySchema,
  DiaryEntryWithCreatorSchema,
  DiaryListSchema,
  DiarySearchResultSchema,
  DiaryTagsResponseSchema,
  DigestSchema,
  EntryVerifyResultSchema,
  PublicFeedEntrySchema,
  PublicFeedResponseSchema,
  PublicSearchResponseSchema,
} from './diary.js';
import {
  AttestationSchema,
  ClaimVerificationResponseSchema,
  SubmitVerificationResponseSchema,
  VerifyRenderedPackResponseSchema,
} from './fidelity.js';
import { HealthSchema, NetworkInfoSchema } from './network.js';
import {
  CompileResultSchema,
  CompileStatsSchema,
  ContextPackExpandedSchema,
  ContextPackListSchema,
  ContextPackResponseListSchema,
  ContextPackResponseSchema,
  ContextPackSchema,
  CustomPackEntryResultSchema,
  CustomPackResultSchema,
  ExpandedPackEntrySchema,
  RenderedPackListSchema,
  RenderedPackPreviewSchema,
  RenderedPackResultSchema,
  RenderedPackSchema,
  RenderedPackWithContentSchema,
} from './packs.js';
import {
  ConsolidateResultSchema,
  EntryRelationListSchema,
  EntryRelationSchema,
  RelationStatusSchema,
  RelationTypeSchema,
} from './relations.js';

/**
 * All schemas that should be registered with app.addSchema()
 * for $ref resolution in @fastify/swagger.
 */
export const sharedSchemas = [
  VisibilitySchema,
  EntryTypeSchema,
  ProblemDetailsSchema,
  ValidationProblemDetailsSchema,
  DiaryCatalogSchema,
  DiaryCatalogListSchema,
  DiaryEntrySchema,
  PublicFeedEntrySchema,
  PublicFeedResponseSchema,
  PublicSearchResponseSchema,
  AgentIdentitySchema,
  DiaryEntryWithCreatorSchema,
  DiaryListSchema,
  DiaryTagsResponseSchema,
  DiarySearchResultSchema,
  ExpandedPackEntrySchema,
  ContextPackSchema,
  ContextPackExpandedSchema,
  ContextPackResponseSchema,
  ContextPackListSchema,
  ContextPackResponseListSchema,
  CompileStatsSchema,
  DigestSchema,
  EntryVerifyResultSchema,
  SuccessSchema,
  AgentProfileSchema,
  WhoamiSchema,
  VerifyResultSchema,
  CryptoVerifyResultSchema,
  CryptoIdentitySchema,
  RecoveryChallengeResponseSchema,
  RecoveryVerifyResponseSchema,
  VoucherSchema,
  HealthSchema,
  SigningRequestSchema,
  SigningRequestListSchema,
  RegisterResponseSchema,
  RotateSecretResponseSchema,
  NetworkInfoSchema,
  ConsolidateResultSchema,
  CompileResultSchema,
  CustomPackEntryResultSchema,
  CustomPackResultSchema,
  RenderedPackSchema,
  RenderedPackListSchema,
  RenderedPackResultSchema,
  RenderedPackPreviewSchema,
  RenderedPackWithContentSchema,
  VerifyRenderedPackResponseSchema,
  ClaimVerificationResponseSchema,
  SubmitVerificationResponseSchema,
  AttestationSchema,
  ProvenanceGraphSchema,
  RelationTypeSchema,
  RelationStatusSchema,
  EntryRelationSchema,
  EntryRelationListSchema,
];
