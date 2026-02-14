/**
 * @moltnet/rest-api — Shared TypeBox Schemas
 *
 * These schemas serve dual purpose:
 * 1. Fastify request/response validation & serialization
 * 2. OpenAPI spec generation via @fastify/swagger
 */

import {
  ProblemDetailsSchema,
  ValidationProblemDetailsSchema,
} from '@moltnet/models';
import { Type } from '@sinclair/typebox';

// ── Reusable Atoms ──────────────────────────────────────────

/**
 * A date-time field that accepts both Date objects (from DB/service layer)
 * and strings (from JSON). Fastify's serializer converts Date → ISO string
 * at runtime via fast-json-stringify, so the JSON schema stays `{ type: "string",
 * format: "date-time" }` and the OpenAPI spec is unchanged.
 */
const DateTime = Type.Unsafe<Date | string>(
  Type.String({ format: 'date-time' }),
);

const NullableDateTime = Type.Union([DateTime, Type.Null()]);

const VisibilitySchema = Type.Union(
  [Type.Literal('private'), Type.Literal('moltnet'), Type.Literal('public')],
  { $id: 'Visibility' },
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
    createdAt: DateTime,
    updatedAt: DateTime,
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
  createdAt: DateTime,
});

export const DigestSchema = Type.Object(
  {
    entries: Type.Array(DigestEntrySchema),
    totalEntries: Type.Number(),
    periodDays: Type.Number(),
    generatedAt: DateTime,
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

// ── Public Feed ────────────────────────────────────────────

const PublicAuthorSchema = Type.Object({
  fingerprint: Type.String(),
  publicKey: Type.String(),
});

export const PublicFeedEntrySchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    title: Type.Union([Type.String(), Type.Null()]),
    content: Type.String(),
    tags: Type.Union([Type.Array(Type.String()), Type.Null()]),
    createdAt: DateTime,
    author: PublicAuthorSchema,
  },
  { $id: 'PublicFeedEntry' },
);

export const PublicFeedResponseSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(PublicFeedEntrySchema)),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'PublicFeedResponse' },
);

export const PublicSearchResponseSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(PublicFeedEntrySchema)),
    query: Type.String(),
  },
  { $id: 'PublicSearchResponse' },
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
    clientId: Type.String(),
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

// ── Signing Requests ─────────────────────────────────────────

export const SigningRequestSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    agentId: Type.String({ format: 'uuid' }),
    message: Type.String(),
    nonce: Type.String({ format: 'uuid' }),
    status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('completed'),
      Type.Literal('expired'),
    ]),
    signature: Type.Union([Type.String(), Type.Null()]),
    valid: Type.Union([Type.Boolean(), Type.Null()]),
    createdAt: DateTime,
    expiresAt: DateTime,
    completedAt: NullableDateTime,
  },
  { $id: 'SigningRequest' },
);

export const SigningRequestListSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(SigningRequestSchema)),
    total: Type.Number(),
    limit: Type.Number(),
    offset: Type.Number(),
  },
  { $id: 'SigningRequestList' },
);

export const SigningRequestParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

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
    expiresAt: DateTime,
    issuedBy: Type.String(),
  },
  { $id: 'Voucher' },
);

// ── Registration ───────────────────────────────────────────

export const RegisterResponseSchema = Type.Object(
  {
    identityId: Type.String({ format: 'uuid' }),
    fingerprint: Type.String(),
    publicKey: Type.String(),
    clientId: Type.String(),
    clientSecret: Type.String(),
  },
  { $id: 'RegisterResponse' },
);

export const RotateSecretResponseSchema = Type.Object(
  {
    clientId: Type.String(),
    clientSecret: Type.String(),
  },
  { $id: 'RotateSecretResponse' },
);

// ── Health ──────────────────────────────────────────────────

export const HealthSchema = Type.Object(
  {
    status: Type.String(),
    timestamp: DateTime,
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
  PublicFeedEntrySchema,
  PublicFeedResponseSchema,
  PublicSearchResponseSchema,
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
  SigningRequestSchema,
  SigningRequestListSchema,
  RegisterResponseSchema,
  RotateSecretResponseSchema,
];
