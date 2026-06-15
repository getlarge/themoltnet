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
export * from './network.js';
export * from './packs.js';
export * from './principal.js';
export * from './relations.js';
export * from './runtime-profiles.js';
export * from './runtime-models.js';
export * from './tasks.js';

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
  DiaryEntryWithRelationsSchema,
  DiaryListSchema,
  DiarySearchResultSchema,
  DiaryTagsResponseSchema,
  EntryVerifyResultSchema,
  PublicFeedEntrySchema,
  PublicFeedResponseSchema,
  PublicSearchResponseSchema,
} from './diary.js';
import { HealthSchema, NetworkInfoSchema, ReadinessSchema } from './network.js';
import {
  CompileStatsSchema,
  ContextPackExpandedSchema,
  ContextPackListSchema,
  ContextPackResponseListSchema,
  ContextPackResponseListWithRenderedSchema,
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
  AgentPrincipalSchema,
  HumanPrincipalSchema,
  PrincipalIdentitySchema,
} from './principal.js';
import {
  EntryRelationListSchema,
  EntryRelationSchema,
  EntryRelationWithDepthSchema,
  ExpandedRelationsSchema,
  RelationStatusSchema,
  RelationTypeSchema,
} from './relations.js';
import { runtimeProfileSchemas } from './runtime-profiles.js';
import { runtimeModelSchemas } from './runtime-models.js';
import { taskSchemas } from './tasks.js';

/**
 * All schemas that should be registered with app.addSchema()
 * for $ref resolution in @fastify/swagger.
 */
export const sharedSchemas = [
  VisibilitySchema,
  EntryTypeSchema,
  ProblemDetailsSchema,
  ValidationProblemDetailsSchema,
  // Register the principal variants BEFORE PrincipalIdentitySchema so the
  // union's Type.Ref(...) entries can resolve at addSchema() time. Anything
  // that embeds `creator: PrincipalIdentitySchema` (diary, packs, teams,
  // ...) MUST be registered AFTER these three.
  AgentPrincipalSchema,
  HumanPrincipalSchema,
  PrincipalIdentitySchema,
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
  ContextPackResponseListWithRenderedSchema,
  CompileStatsSchema,
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
  ...runtimeProfileSchemas,
  ...runtimeModelSchemas,
  HealthSchema,
  ReadinessSchema,
  SigningRequestSchema,
  SigningRequestListSchema,
  RegisterResponseSchema,
  RotateSecretResponseSchema,
  NetworkInfoSchema,
  CustomPackEntryResultSchema,
  CustomPackResultSchema,
  RenderedPackSchema,
  RenderedPackListSchema,
  RenderedPackResultSchema,
  RenderedPackPreviewSchema,
  RenderedPackWithContentSchema,
  ProvenanceGraphSchema,
  RelationTypeSchema,
  RelationStatusSchema,
  EntryRelationSchema,
  EntryRelationListSchema,
  EntryRelationWithDepthSchema,
  ExpandedRelationsSchema,
  DiaryEntryWithRelationsSchema,
  ...taskSchemas,
];
