import { VerificationMethodSchema } from '@moltnet/models';
import { Type } from 'typebox';

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
    verificationMethod: VerificationMethodSchema,
    requestedBy: Type.Optional(
      Type.Union([
        Type.Object({
          id: Type.String(),
          type: Type.Union([
            Type.Literal('agent'),
            Type.Literal('human'),
            Type.Literal('service'),
          ]),
        }),
        Type.Null(),
      ]),
    ),
    signerConstraint: Type.Optional(
      Type.Union([
        Type.Object({
          id: Type.Optional(Type.String()),
          type: Type.Union([
            Type.Literal('human'),
            Type.Literal('team-role'),
            Type.Literal('group'),
            Type.Literal('site'),
            Type.Literal('station'),
          ]),
        }),
        Type.Null(),
      ]),
    ),
    teamId: Type.Optional(
      Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    ),
    purpose: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    claimedByHumanId: Type.Optional(
      Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    ),
    signingCredentialId: Type.Optional(
      Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    ),
    challenge: Type.Optional(
      Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
    ),
    message: Type.String(),
    nonce: Type.String({ format: 'uuid' }),
    signingInput: Type.String({
      description:
        'Base64-encoded bytes to sign with Ed25519. Base64-decode this value, ' +
        'sign the raw bytes with your private key, then submit the base64 signature.',
    }),
    status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('claimed'),
      Type.Literal('completed'),
      Type.Literal('rejected'),
      Type.Literal('expired'),
    ]),
    signature: Type.Union([Type.String(), Type.Null()]),
    valid: Type.Union([Type.Boolean(), Type.Null()]),
    createdAt: DateTime,
    expiresAt: DateTime,
    completedAt: NullableDateTime,
    claimedAt: Type.Optional(NullableDateTime),
    rejectedAt: Type.Optional(NullableDateTime),
    rejectionReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { $id: 'SigningRequest' },
);

export const SigningRequestListSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(SigningRequestSchema.$id)),
    total: Type.Number(),
    limit: Type.Number(),
    offset: Type.Number(),
  },
  { $id: 'SigningRequestList' },
);

export const SigningRequestParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

// ── Signing Credentials ──────────────────────────────────────

const JsonObjectSchema = Type.Record(Type.String(), Type.Unknown());

export const SigningMethodValueSchema = Type.Object({
  verificationMethod: VerificationMethodSchema,
  value: Type.Unknown(),
});

export const SigningCredentialSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    ownerType: Type.Literal('human'),
    ownerHumanId: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    verificationMethod: VerificationMethodSchema,
    credentialType: Type.String(),
    algorithm: Type.String(),
    publicMaterial: Type.Intersect([
      Type.Object({ version: Type.Integer({ minimum: 1 }) }),
      JsonObjectSchema,
    ]),
    enrollmentEvidence: Type.Intersect([
      Type.Object({ version: Type.Integer({ minimum: 1 }) }),
      JsonObjectSchema,
    ]),
    label: Type.String(),
    status: Type.Union([
      Type.Literal('pending_approval'),
      Type.Literal('active'),
      Type.Literal('suspended'),
      Type.Literal('revoked'),
    ]),
    approvedByHumanId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
    createdAt: DateTime,
    updatedAt: DateTime,
    activatedAt: NullableDateTime,
    suspendedAt: NullableDateTime,
    revokedAt: NullableDateTime,
  },
  { $id: 'SigningCredential' },
);

export const SigningCredentialListSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(SigningCredentialSchema.$id)),
    total: Type.Number(),
    limit: Type.Number(),
    offset: Type.Number(),
  },
  { $id: 'SigningCredentialList' },
);

export const SigningCredentialRegistrationSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    challenge: SigningMethodValueSchema,
    expiresAt: DateTime,
  },
  { $id: 'SigningCredentialRegistration' },
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
