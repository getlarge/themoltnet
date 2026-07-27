import {
  PrincipalIdentitySchema,
  SignerConstraintSchema,
  VerificationMethodSchema,
} from '@moltnet/models';
import { type Static, Type } from 'typebox';

import { DateTime, NullableDateTime } from './atoms.js';

const PREVIEW_SIGN_METHOD = 'human-hardware-previewsign';
const PREVIEW_SIGN_CREDENTIAL_TYPE = 'preview-sign-arkg';
const PREVIEW_SIGN_ALGORITHM = 'arkg-p256-esp256';
const Base64Url = Type.String({
  minLength: 1,
  maxLength: 5462,
  pattern: '^[A-Za-z0-9_-]+$',
});
const Sha256Base64Url = Type.String({
  minLength: 43,
  maxLength: 43,
  pattern: '^[A-Za-z0-9_-]+$',
});
const P256CoordinateBase64Url = Type.String({
  minLength: 43,
  maxLength: 43,
  pattern: '^[A-Za-z0-9_-]+$',
});
const P256DerSignatureBase64Url = Type.String({
  minLength: 11,
  maxLength: 96,
  pattern: '^[A-Za-z0-9_-]+$',
});

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

export const PreviewSignEs256PublicKeySchema = Type.Object(
  {
    kty: Type.Literal(2),
    algorithm: Type.Literal(-7),
    curve: Type.Literal(1),
    x: P256CoordinateBase64Url,
    y: P256CoordinateBase64Url,
  },
  { $id: 'PreviewSignEs256PublicKey', additionalProperties: false },
);

export const PreviewSignEcdhEsHkdf256PublicKeySchema = Type.Object(
  {
    kty: Type.Literal(2),
    algorithm: Type.Literal(-25),
    curve: Type.Literal(1),
    x: P256CoordinateBase64Url,
    y: P256CoordinateBase64Url,
  },
  {
    $id: 'PreviewSignEcdhEsHkdf256PublicKey',
    additionalProperties: false,
  },
);

export const PreviewSignEsp256PublicKeySchema = Type.Object(
  {
    kty: Type.Literal(2),
    algorithm: Type.Literal(-9),
    curve: Type.Literal(1),
    x: P256CoordinateBase64Url,
    y: P256CoordinateBase64Url,
  },
  { $id: 'PreviewSignEsp256PublicKey', additionalProperties: false },
);

export const PreviewSignArkgSeedPublicKeySchema = Type.Object(
  {
    kty: Type.Literal(-65537),
    algorithm: Type.Literal(-65700),
    derivedAlgorithm: Type.Literal(-9),
    blindingKey: Type.Unsafe<Static<typeof PreviewSignEs256PublicKeySchema>>(
      Type.Ref(PreviewSignEs256PublicKeySchema.$id),
    ),
    kemKey: Type.Unsafe<Static<typeof PreviewSignEcdhEsHkdf256PublicKeySchema>>(
      Type.Ref(PreviewSignEcdhEsHkdf256PublicKeySchema.$id),
    ),
  },
  { $id: 'PreviewSignArkgSeedPublicKey', additionalProperties: false },
);

export const PreviewSignPublicMaterialSchema = Type.Object(
  {
    version: Type.Literal(1),
    outerCredentialId: Base64Url,
    outerPublicKey: Type.Unsafe<Static<typeof PreviewSignEs256PublicKeySchema>>(
      Type.Ref(PreviewSignEs256PublicKeySchema.$id),
    ),
    previewKeyHandle: Base64Url,
    seedPublicKey: Type.Unsafe<
      Static<typeof PreviewSignArkgSeedPublicKeySchema>
    >(Type.Ref(PreviewSignArkgSeedPublicKeySchema.$id)),
  },
  { $id: 'PreviewSignPublicMaterial', additionalProperties: false },
);

export const PreviewSignChallengeSchema = Type.Object(
  {
    verificationMethod: Type.Literal(PREVIEW_SIGN_METHOD),
    version: Type.Literal(1),
    envelope: Base64Url,
    digest: Sha256Base64Url,
    additionalArguments: Base64Url,
    outerCredentialId: Base64Url,
    outerPublicKey: Type.Unsafe<Static<typeof PreviewSignEs256PublicKeySchema>>(
      Type.Ref(PreviewSignEs256PublicKeySchema.$id),
    ),
    previewKeyHandle: Base64Url,
  },
  { $id: 'PreviewSignChallenge', additionalProperties: false },
);

export const PreviewSignReceiptSchema = Type.Object(
  {
    version: Type.Literal(1),
    signature: P256DerSignatureBase64Url,
  },
  { $id: 'PreviewSignReceipt', additionalProperties: false },
);

export const PreviewSignEvidenceSchema = Type.Object(
  {
    version: Type.Literal(1),
    operation: Type.Union([
      Type.Literal('credential-registration'),
      Type.Literal('signing-request'),
    ]),
    requestId: Type.String({ format: 'uuid' }),
    credentialId: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    claimantId: Type.String({ format: 'uuid' }),
    verificationMethod: Type.Literal(PREVIEW_SIGN_METHOD),
    nonce: Type.String(),
    purpose: Type.String(),
    expiresAt: DateTime,
    envelope: Base64Url,
    digest: Sha256Base64Url,
    additionalArgumentsHash: Sha256Base64Url,
    derivedPublicKey: Type.Unsafe<
      Static<typeof PreviewSignEsp256PublicKeySchema>
    >(Type.Ref(PreviewSignEsp256PublicKeySchema.$id)),
    signature: P256DerSignatureBase64Url,
    proofHash: Sha256Base64Url,
  },
  { $id: 'PreviewSignEvidence', additionalProperties: false },
);

export const PreviewSignChallengeValueSchema = Type.Object(
  {
    verificationMethod: Type.Literal(PREVIEW_SIGN_METHOD),
    value: Type.Unsafe<Static<typeof PreviewSignChallengeSchema>>(
      Type.Ref(PreviewSignChallengeSchema.$id),
    ),
  },
  { $id: 'PreviewSignChallengeValue', additionalProperties: false },
);

export const PreviewSignChallengeOperationSchema = Type.Union(
  [Type.Literal('credential-registration'), Type.Literal('signing-request')],
  { $id: 'PreviewSignChallengeOperation' },
);

export const ValidatePreviewSignChallengeSchema = Type.Object(
  {
    version: Type.Literal(1),
    operation: Type.Unsafe<Static<typeof PreviewSignChallengeOperationSchema>>(
      Type.Ref(PreviewSignChallengeOperationSchema.$id),
    ),
    resourceId: Type.String({ format: 'uuid' }),
    challenge: Type.Unsafe<Static<typeof PreviewSignChallengeValueSchema>>(
      Type.Ref(PreviewSignChallengeValueSchema.$id),
    ),
  },
  {
    $id: 'ValidatePreviewSignChallenge',
    additionalProperties: false,
  },
);

export const PreviewSignChallengeValidationSchema = Type.Object(
  {
    valid: Type.Literal(true),
  },
  {
    $id: 'PreviewSignChallengeValidation',
    additionalProperties: false,
  },
);

export const PreviewSignReceiptValueSchema = Type.Object(
  {
    verificationMethod: Type.Literal(PREVIEW_SIGN_METHOD),
    value: Type.Unsafe<Static<typeof PreviewSignReceiptSchema>>(
      Type.Ref(PreviewSignReceiptSchema.$id),
    ),
  },
  { $id: 'PreviewSignReceiptValue', additionalProperties: false },
);

export const PreviewSignEvidenceValueSchema = Type.Object(
  {
    verificationMethod: Type.Literal(PREVIEW_SIGN_METHOD),
    value: Type.Unsafe<Static<typeof PreviewSignEvidenceSchema>>(
      Type.Ref(PreviewSignEvidenceSchema.$id),
    ),
  },
  { $id: 'PreviewSignEvidenceValue', additionalProperties: false },
);

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
      Type.Union([SignerConstraintSchema, Type.Null()]),
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
      Type.Union([
        Type.Unsafe<Static<typeof PreviewSignChallengeValueSchema>>(
          Type.Ref(PreviewSignChallengeValueSchema.$id),
        ),
        Type.Null(),
      ]),
    ),
    receipt: Type.Optional(
      Type.Union([
        Type.Unsafe<Static<typeof PreviewSignEvidenceValueSchema>>(
          Type.Ref(PreviewSignEvidenceValueSchema.$id),
        ),
        Type.Null(),
      ]),
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

export const SigningCredentialSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    owner: PrincipalIdentitySchema,
    teamId: Type.String({ format: 'uuid' }),
    verificationMethod: Type.Literal(PREVIEW_SIGN_METHOD),
    credentialType: Type.Literal(PREVIEW_SIGN_CREDENTIAL_TYPE),
    algorithm: Type.Literal(PREVIEW_SIGN_ALGORITHM),
    publicMaterial: Type.Unsafe<Static<typeof PreviewSignPublicMaterialSchema>>(
      Type.Ref(PreviewSignPublicMaterialSchema.$id),
    ),
    enrollmentEvidence: Type.Unsafe<Static<typeof PreviewSignEvidenceSchema>>(
      Type.Ref(PreviewSignEvidenceSchema.$id),
    ),
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
    challenge: Type.Unsafe<Static<typeof PreviewSignChallengeValueSchema>>(
      Type.Ref(PreviewSignChallengeValueSchema.$id),
    ),
    expiresAt: DateTime,
  },
  { $id: 'SigningCredentialRegistration' },
);

export const BeginPreviewSignCredentialRegistrationSchema = Type.Object(
  {
    verificationMethod: Type.Literal(PREVIEW_SIGN_METHOD),
    credentialType: Type.Literal(PREVIEW_SIGN_CREDENTIAL_TYPE),
    algorithm: Type.Literal(PREVIEW_SIGN_ALGORITHM),
    publicMaterial: Type.Unsafe<Static<typeof PreviewSignPublicMaterialSchema>>(
      Type.Ref(PreviewSignPublicMaterialSchema.$id),
    ),
    label: Type.String({ minLength: 1, maxLength: 255 }),
  },
  {
    $id: 'BeginPreviewSignCredentialRegistration',
    additionalProperties: false,
  },
);

export const CompletePreviewSignCredentialRegistrationSchema = Type.Object(
  {
    publicMaterial: Type.Unsafe<Static<typeof PreviewSignPublicMaterialSchema>>(
      Type.Ref(PreviewSignPublicMaterialSchema.$id),
    ),
    receipt: Type.Unsafe<Static<typeof PreviewSignReceiptValueSchema>>(
      Type.Ref(PreviewSignReceiptValueSchema.$id),
    ),
  },
  {
    $id: 'CompletePreviewSignCredentialRegistration',
    additionalProperties: false,
  },
);

export const CompletePreviewSignRequestSchema = Type.Object(
  {
    receipt: Type.Unsafe<Static<typeof PreviewSignReceiptValueSchema>>(
      Type.Ref(PreviewSignReceiptValueSchema.$id),
    ),
  },
  { $id: 'CompletePreviewSignRequest', additionalProperties: false },
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
