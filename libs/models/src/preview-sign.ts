import { type Static, type TSchema, Type } from 'typebox';

function schemaRef<T extends TSchema>(schema: T, id: string) {
  void schema;
  return Type.Unsafe<Static<T>>(Type.Ref(id));
}

export const PreviewSignBase64UrlSchema = Type.String({
  $id: 'PreviewSignBase64Url',
  minLength: 1,
  maxLength: 5462,
  pattern: '^[A-Za-z0-9_-]+$',
});

export const PreviewSignSha256Base64UrlSchema = Type.String({
  $id: 'PreviewSignSha256Base64Url',
  minLength: 43,
  maxLength: 43,
  pattern: '^[A-Za-z0-9_-]+$',
});

export const PreviewSignP256DerSignatureBase64UrlSchema = Type.String({
  $id: 'PreviewSignP256DerSignatureBase64Url',
  minLength: 11,
  maxLength: 96,
  pattern: '^[A-Za-z0-9_-]+$',
});

export const PreviewSignEs256PublicKeySchema = Type.Object(
  {
    kty: Type.Literal(2),
    algorithm: Type.Literal(-7),
    curve: Type.Literal(1),
    x: schemaRef(
      PreviewSignSha256Base64UrlSchema,
      'PreviewSignSha256Base64Url',
    ),
    y: schemaRef(
      PreviewSignSha256Base64UrlSchema,
      'PreviewSignSha256Base64Url',
    ),
  },
  { $id: 'PreviewSignEs256PublicKey', additionalProperties: false },
);

export const PreviewSignEcdhEsHkdf256PublicKeySchema = Type.Object(
  {
    kty: Type.Literal(2),
    algorithm: Type.Literal(-25),
    curve: Type.Literal(1),
    x: schemaRef(
      PreviewSignSha256Base64UrlSchema,
      'PreviewSignSha256Base64Url',
    ),
    y: schemaRef(
      PreviewSignSha256Base64UrlSchema,
      'PreviewSignSha256Base64Url',
    ),
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
    x: schemaRef(
      PreviewSignSha256Base64UrlSchema,
      'PreviewSignSha256Base64Url',
    ),
    y: schemaRef(
      PreviewSignSha256Base64UrlSchema,
      'PreviewSignSha256Base64Url',
    ),
  },
  { $id: 'PreviewSignEsp256PublicKey', additionalProperties: false },
);

export const PreviewSignArkgSeedPublicKeySchema = Type.Object(
  {
    kty: Type.Literal(-65537),
    algorithm: Type.Literal(-65700),
    derivedAlgorithm: Type.Literal(-9),
    blindingKey: schemaRef(
      PreviewSignEs256PublicKeySchema,
      'PreviewSignEs256PublicKey',
    ),
    kemKey: schemaRef(
      PreviewSignEcdhEsHkdf256PublicKeySchema,
      'PreviewSignEcdhEsHkdf256PublicKey',
    ),
  },
  { $id: 'PreviewSignArkgSeedPublicKey', additionalProperties: false },
);

export const PreviewSignPublicMaterialSchema = Type.Object(
  {
    version: Type.Literal(1),
    outerCredentialId: schemaRef(
      PreviewSignBase64UrlSchema,
      'PreviewSignBase64Url',
    ),
    outerPublicKey: schemaRef(
      PreviewSignEs256PublicKeySchema,
      'PreviewSignEs256PublicKey',
    ),
    previewKeyHandle: schemaRef(
      PreviewSignBase64UrlSchema,
      'PreviewSignBase64Url',
    ),
    seedPublicKey: schemaRef(
      PreviewSignArkgSeedPublicKeySchema,
      'PreviewSignArkgSeedPublicKey',
    ),
  },
  { $id: 'PreviewSignPublicMaterial', additionalProperties: false },
);

export const PreviewSignChallengeSchema = Type.Object(
  {
    verificationMethod: Type.Literal('human-hardware-previewsign'),
    version: Type.Literal(1),
    envelope: schemaRef(PreviewSignBase64UrlSchema, 'PreviewSignBase64Url'),
    digest: schemaRef(
      PreviewSignSha256Base64UrlSchema,
      'PreviewSignSha256Base64Url',
    ),
    additionalArguments: schemaRef(
      PreviewSignBase64UrlSchema,
      'PreviewSignBase64Url',
    ),
    outerCredentialId: schemaRef(
      PreviewSignBase64UrlSchema,
      'PreviewSignBase64Url',
    ),
    outerPublicKey: schemaRef(
      PreviewSignEs256PublicKeySchema,
      'PreviewSignEs256PublicKey',
    ),
    previewKeyHandle: schemaRef(
      PreviewSignBase64UrlSchema,
      'PreviewSignBase64Url',
    ),
  },
  { $id: 'PreviewSignChallenge', additionalProperties: false },
);

export const PreviewSignChallengeValueSchema = Type.Object(
  {
    verificationMethod: Type.Literal('human-hardware-previewsign'),
    value: schemaRef(PreviewSignChallengeSchema, 'PreviewSignChallenge'),
  },
  { $id: 'PreviewSignChallengeValue', additionalProperties: false },
);

export const PreviewSignChallengeOperationSchema = Type.Union(
  [Type.Literal('credential-registration'), Type.Literal('signing-request')],
  { $id: 'PreviewSignChallengeOperation' },
);

export const PreviewSignReceiptSchema = Type.Object(
  {
    version: Type.Literal(1),
    signature: schemaRef(
      PreviewSignP256DerSignatureBase64UrlSchema,
      'PreviewSignP256DerSignatureBase64Url',
    ),
  },
  { $id: 'PreviewSignReceipt', additionalProperties: false },
);

export const PreviewSignReceiptValueSchema = Type.Object(
  {
    verificationMethod: Type.Literal('human-hardware-previewsign'),
    value: schemaRef(PreviewSignReceiptSchema, 'PreviewSignReceipt'),
  },
  { $id: 'PreviewSignReceiptValue', additionalProperties: false },
);

export const previewSignSchemaContext = {
  PreviewSignBase64Url: PreviewSignBase64UrlSchema,
  PreviewSignSha256Base64Url: PreviewSignSha256Base64UrlSchema,
  PreviewSignP256DerSignatureBase64Url:
    PreviewSignP256DerSignatureBase64UrlSchema,
  PreviewSignEs256PublicKey: PreviewSignEs256PublicKeySchema,
  PreviewSignEcdhEsHkdf256PublicKey: PreviewSignEcdhEsHkdf256PublicKeySchema,
  PreviewSignEsp256PublicKey: PreviewSignEsp256PublicKeySchema,
  PreviewSignArkgSeedPublicKey: PreviewSignArkgSeedPublicKeySchema,
  PreviewSignPublicMaterial: PreviewSignPublicMaterialSchema,
  PreviewSignChallenge: PreviewSignChallengeSchema,
  PreviewSignChallengeValue: PreviewSignChallengeValueSchema,
  PreviewSignChallengeOperation: PreviewSignChallengeOperationSchema,
  PreviewSignReceipt: PreviewSignReceiptSchema,
  PreviewSignReceiptValue: PreviewSignReceiptValueSchema,
} as const;

export type PreviewSignPublicMaterial = Static<
  typeof PreviewSignPublicMaterialSchema
>;
export type PreviewSignChallengeValue = Static<
  typeof PreviewSignChallengeValueSchema
>;
