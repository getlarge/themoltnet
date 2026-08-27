import {
  PreviewSignArkgSeedPublicKeySchema,
  PreviewSignBase64UrlSchema,
  PreviewSignChallengeOperationSchema,
  PreviewSignChallengeSchema,
  PreviewSignChallengeValueSchema,
  PreviewSignEcdhEsHkdf256PublicKeySchema,
  PreviewSignEs256PublicKeySchema,
  PreviewSignEsp256PublicKeySchema,
  PreviewSignP256DerSignatureBase64UrlSchema,
  PreviewSignPublicMaterialSchema,
  PreviewSignReceiptSchema,
  PreviewSignReceiptValueSchema,
  PreviewSignSha256Base64UrlSchema,
  PrincipalIdentitySchema,
  SignerConstraintSchema,
  VerificationMethodSchema,
} from '@moltnet/models';
import { type Static, Type } from 'typebox';

import { DateTime, NullableDateTime } from './atoms.js';

const PREVIEW_SIGN_METHOD = 'human-hardware-previewsign';
const PREVIEW_SIGN_CREDENTIAL_TYPE = 'preview-sign-arkg';
const PREVIEW_SIGN_ALGORITHM = 'arkg-p256-esp256';
const Base64Url = Type.Unsafe<Static<typeof PreviewSignBase64UrlSchema>>(
  Type.Ref('PreviewSignBase64Url'),
);
const Sha256Base64Url = Type.Unsafe<
  Static<typeof PreviewSignSha256Base64UrlSchema>
>(Type.Ref('PreviewSignSha256Base64Url'));
const P256DerSignatureBase64Url = Type.Unsafe<
  Static<typeof PreviewSignP256DerSignatureBase64UrlSchema>
>(Type.Ref('PreviewSignP256DerSignatureBase64Url'));

export {
  PreviewSignArkgSeedPublicKeySchema,
  PreviewSignBase64UrlSchema,
  PreviewSignChallengeOperationSchema,
  PreviewSignChallengeSchema,
  PreviewSignChallengeValueSchema,
  PreviewSignEcdhEsHkdf256PublicKeySchema,
  PreviewSignEs256PublicKeySchema,
  PreviewSignEsp256PublicKeySchema,
  PreviewSignP256DerSignatureBase64UrlSchema,
  PreviewSignPublicMaterialSchema,
  PreviewSignReceiptSchema,
  PreviewSignReceiptValueSchema,
  PreviewSignSha256Base64UrlSchema,
};

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
    >(Type.Ref('PreviewSignEsp256PublicKey')),
    signature: P256DerSignatureBase64Url,
    proofHash: Sha256Base64Url,
  },
  { $id: 'PreviewSignEvidence', additionalProperties: false },
);

export const ValidatePreviewSignChallengeSchema = Type.Object(
  {
    version: Type.Literal(1),
    operation: Type.Unsafe<Static<typeof PreviewSignChallengeOperationSchema>>(
      Type.Ref('PreviewSignChallengeOperation'),
    ),
    resourceId: Type.String({ format: 'uuid' }),
    challenge: Type.Unsafe<Static<typeof PreviewSignChallengeValueSchema>>(
      Type.Ref('PreviewSignChallengeValue'),
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
          Type.Ref('PreviewSignChallengeValue'),
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
      Type.Ref('PreviewSignPublicMaterial'),
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
      Type.Ref('PreviewSignChallengeValue'),
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
      Type.Ref('PreviewSignPublicMaterial'),
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
      Type.Ref('PreviewSignPublicMaterial'),
    ),
    receipt: Type.Unsafe<Static<typeof PreviewSignReceiptValueSchema>>(
      Type.Ref('PreviewSignReceiptValue'),
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
      Type.Ref('PreviewSignReceiptValue'),
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

export const RecoveryCredentialsResponseSchema = Type.Object(
  {
    sealedCredentials: Type.String({
      description:
        'X25519 sealed envelope containing the replacement OAuth2 clientId and clientSecret',
    }),
  },
  { $id: 'RecoveryCredentialsResponse' },
);
