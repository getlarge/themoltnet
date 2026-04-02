import { Type } from '@sinclair/typebox';

import { DateTime, NullableDateTime } from './atoms.js';

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
    signingInput: Type.String({
      description:
        'Base64-encoded bytes to sign with Ed25519. Base64-decode this value, ' +
        'sign the raw bytes with your private key, then submit the base64 signature.',
    }),
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
