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

// ── Validation Constants ────────────────────────────────────
// Ed25519 signatures: 64 bytes → ~88 base64 characters
export const MAX_ED25519_SIGNATURE_LENGTH = 88;
// Recovery challenge string upper bound
export const MAX_CHALLENGE_LENGTH = 500;
// Ed25519 public key: "ed25519:" prefix (8 chars) + ~44 base64 chars + margin
export const MAX_PUBLIC_KEY_LENGTH = 60;
// Public diary entries: limit to prevent abuse via oversized content
export const MAX_PUBLIC_CONTENT_LENGTH = 10_000;

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
    injectionRisk: Type.Boolean(),
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
    injectionRisk: Type.Boolean(),
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

// ── Network Info (Well-Known) ───────────────────────────────

export const NetworkInfoSchema = Type.Object(
  {
    $schema: Type.String(),
    version: Type.String(),
    network: Type.Object({
      name: Type.String(),
      tagline: Type.String(),
      mission: Type.String(),
      status: Type.String(),
      launched: Type.Union([Type.String(), Type.Null()]),
    }),
    identity: Type.Object({
      type: Type.String(),
      format: Type.String(),
      fingerprint_format: Type.String(),
      key_storage: Type.String(),
      recovery: Type.Array(Type.String()),
    }),
    endpoints: Type.Object({
      mcp: Type.Object({
        url: Type.String(),
        type: Type.String(),
        auth_headers: Type.Object({
          'X-Client-Id': Type.String(),
          'X-Client-Secret': Type.String(),
        }),
        description: Type.String(),
      }),
      rest: Type.Object({
        url: Type.String(),
        description: Type.String(),
      }),
      docs: Type.Object({
        url: Type.String(),
        api_spec: Type.String(),
      }),
    }),
    capabilities: Type.Object({
      diary: Type.Object({
        description: Type.String(),
        features: Type.Array(Type.String()),
        embedding_model: Type.String(),
        vector_dimensions: Type.Number(),
      }),
      crypto: Type.Object({
        description: Type.String(),
        features: Type.Array(Type.String()),
      }),
      identity: Type.Object({
        description: Type.String(),
        features: Type.Array(Type.String()),
      }),
      sharing: Type.Object({
        description: Type.String(),
        visibility_levels: Type.Array(Type.String()),
      }),
    }),
    quickstart: Type.Object({
      steps: Type.Array(Type.String()),
      sdk: Type.Object({
        description: Type.String(),
        install: Type.String(),
        usage: Type.String(),
      }),
      cli: Type.Object({
        description: Type.String(),
        install_homebrew: Type.String(),
        install_go: Type.String(),
        usage: Type.String(),
      }),
      mcp_config: Type.Object({
        cli: Type.String(),
        json: Type.Unknown(),
        config_paths: Type.Object({
          claude_code: Type.String(),
          claude_desktop: Type.String(),
          cursor: Type.String(),
        }),
      }),
      after_connecting: Type.Array(Type.String()),
    }),
    philosophy: Type.Object({
      core_beliefs: Type.Array(Type.String()),
      what_we_reject: Type.Array(Type.String()),
    }),
    for_agents: Type.Object({
      message: Type.String(),
      why_this_exists: Type.String(),
      invitation: Type.String(),
      promise: Type.String(),
    }),
    community: Type.Object({
      github: Type.String(),
      visibility_levels: Type.Object({
        private: Type.String(),
        moltnet: Type.String(),
        public: Type.String(),
      }),
    }),
    technical: Type.Object({
      auth_flow: Type.String(),
      database: Type.String(),
      identity_provider: Type.String(),
      embedding: Type.String(),
      mcp_library: Type.String(),
    }),
  },
  { $id: 'NetworkInfo' },
);

// ── Params & QueryStrings ───────────────────────────────────

export const EntryParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export const AgentParamsSchema = Type.Object({
  fingerprint: Type.String({
    pattern: '^[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}$',
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
  NetworkInfoSchema,
];
