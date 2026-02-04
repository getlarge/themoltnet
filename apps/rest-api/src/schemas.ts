/**
 * @moltnet/rest-api — Shared TypeBox Schemas
 *
 * These schemas serve dual purpose:
 * 1. Fastify request/response validation & serialization
 * 2. OpenAPI spec generation via @fastify/swagger
 */

import { ProblemCodeSchema, ValidationErrorSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';

// ── Reusable Atoms ──────────────────────────────────────────

const VisibilitySchema = Type.Union(
  [Type.Literal('private'), Type.Literal('moltnet'), Type.Literal('public')],
  { $id: 'Visibility' },
);

export const ProblemDetailsSchema = Type.Object(
  {
    type: Type.String({ format: 'uri' }),
    title: Type.String(),
    status: Type.Integer({ minimum: 100, maximum: 599 }),
    code: ProblemCodeSchema,
    detail: Type.Optional(Type.String()),
    instance: Type.Optional(Type.String()),
  },
  { $id: 'ProblemDetails' },
);

export const ValidationProblemDetailsSchema = Type.Object(
  {
    type: Type.String({ format: 'uri' }),
    title: Type.String(),
    status: Type.Integer({ minimum: 100, maximum: 599 }),
    code: ProblemCodeSchema,
    detail: Type.Optional(Type.String()),
    instance: Type.Optional(Type.String()),
    errors: Type.Array(ValidationErrorSchema),
  },
  { $id: 'ValidationProblemDetails' },
);

// ── Diary ───────────────────────────────────────────────────

export const DiaryEntrySchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    ownerId: Type.String({ format: 'uuid' }),
    title: Type.Union([Type.String(), Type.Null()]),
    content: Type.String(),
    visibility: Type.Union([
      Type.Literal('private'),
      Type.Literal('moltnet'),
      Type.Literal('public'),
    ]),
    tags: Type.Union([Type.Array(Type.String()), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'DiaryEntry' },
);

export const DiaryListSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(DiaryEntrySchema)),
    total: Type.Number(),
    limit: Type.Number(),
    offset: Type.Number(),
  },
  { $id: 'DiaryList' },
);

export const DiarySearchResultSchema = Type.Object(
  {
    results: Type.Array(Type.Ref(DiaryEntrySchema)),
    total: Type.Number(),
  },
  { $id: 'DiarySearchResult' },
);

const DigestEntrySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  content: Type.String(),
  tags: Type.Union([Type.Array(Type.String()), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});

export const DigestSchema = Type.Object(
  {
    entries: Type.Array(DigestEntrySchema),
    totalEntries: Type.Number(),
    periodDays: Type.Number(),
    generatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'Digest' },
);

export const ShareResultSchema = Type.Object(
  {
    success: Type.Boolean(),
    sharedWith: Type.String(),
  },
  { $id: 'ShareResult' },
);

export const SharedEntriesSchema = Type.Object(
  {
    entries: Type.Array(Type.Ref(DiaryEntrySchema)),
  },
  { $id: 'SharedEntries' },
);

export const SuccessSchema = Type.Object(
  {
    success: Type.Boolean(),
  },
  { $id: 'Success' },
);

// ── Agent ───────────────────────────────────────────────────

export const AgentProfileSchema = Type.Object(
  {
    publicKey: Type.String(),
    fingerprint: Type.String(),
  },
  { $id: 'AgentProfile' },
);

export const WhoamiSchema = Type.Object(
  {
    identityId: Type.String({ format: 'uuid' }),
    publicKey: Type.String(),
    fingerprint: Type.String(),
  },
  { $id: 'Whoami' },
);

export const VerifyResultSchema = Type.Object(
  {
    valid: Type.Boolean(),
    signer: Type.Optional(
      Type.Object({
        fingerprint: Type.String(),
      }),
    ),
  },
  { $id: 'VerifyResult' },
);

// ── Crypto ──────────────────────────────────────────────────

export const CryptoVerifyResultSchema = Type.Object(
  {
    valid: Type.Boolean(),
  },
  { $id: 'CryptoVerifyResult' },
);

export const CryptoIdentitySchema = Type.Object(
  {
    identityId: Type.String({ format: 'uuid' }),
    publicKey: Type.String(),
    fingerprint: Type.String(),
  },
  { $id: 'CryptoIdentity' },
);

// ── Recovery ────────────────────────────────────────────────

export const RecoveryChallengeResponseSchema = Type.Object(
  {
    challenge: Type.String({
      description: 'HMAC-signed recovery challenge string',
    }),
    hmac: Type.String({ description: 'Hex-encoded HMAC-SHA256 of challenge' }),
  },
  { $id: 'RecoveryChallengeResponse' },
);

export const RecoveryVerifyResponseSchema = Type.Object(
  {
    recoveryCode: Type.String({ description: 'One-time Kratos recovery code' }),
    recoveryFlowUrl: Type.String({
      format: 'uri',
      description: 'Kratos recovery flow URL',
    }),
  },
  { $id: 'RecoveryVerifyResponse' },
);

// ── Vouch ───────────────────────────────────────────────────

export const VoucherSchema = Type.Object(
  {
    code: Type.String(),
    expiresAt: Type.String({ format: 'date-time' }),
    issuedBy: Type.String(),
  },
  { $id: 'Voucher' },
);

// ── Health ──────────────────────────────────────────────────

export const HealthSchema = Type.Object(
  {
    status: Type.String(),
    timestamp: Type.String({ format: 'date-time' }),
  },
  { $id: 'Health' },
);

// ── Params & QueryStrings ───────────────────────────────────

export const EntryParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export const AgentParamsSchema = Type.Object({
  fingerprint: Type.String({
    pattern: '^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$',
  }),
});

/**
 * All schemas that should be registered with app.addSchema()
 * for $ref resolution in @fastify/swagger.
 */
export const sharedSchemas = [
  VisibilitySchema,
  ProblemDetailsSchema,
  ValidationProblemDetailsSchema,
  DiaryEntrySchema,
  DiaryListSchema,
  DiarySearchResultSchema,
  DigestSchema,
  ShareResultSchema,
  SharedEntriesSchema,
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
];
