/**
 * Crypto MCP tool input schemas.
 *
 * Covers: crypto_prepare_signature/submit_signature/signing_status/verify.
 */

import type {
  CreateSigningRequestData,
  GetSigningRequestData,
  SubmitSignatureData,
  VerifyCryptoSignatureData,
} from '@moltnet/api-client';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type {
  AssertSchemaToApi,
  BodyOf,
  PathOf,
  SnakeCasedProperties,
} from './common.js';

export const CryptoPrepareSignatureSchema = Type.Object({
  message: Type.String({ description: 'The message to sign' }),
});
export type CryptoPrepareSignatureInput = BodyOf<CreateSigningRequestData>;

export const CryptoSubmitSignatureSchema = Type.Object({
  request_id: Type.String({
    description: 'The signing request ID from crypto_prepare_signature',
  }),
  signature: Type.String({ description: 'The Ed25519 signature (base64)' }),
});
export type CryptoSubmitSignatureInput = SnakeCasedProperties<
  BodyOf<SubmitSignatureData>
> & {
  request_id: PathOf<SubmitSignatureData>['id'];
};

export const CryptoSigningStatusSchema = Type.Object({
  request_id: Type.String({ description: 'The signing request ID to check' }),
});
export type CryptoSigningStatusInput = {
  request_id: PathOf<GetSigningRequestData>['id'];
};

export const CryptoVerifySchema = Type.Object({
  signature: Type.String({ description: 'The signature to verify' }),
});
export type CryptoVerifyInput = BodyOf<VerifyCryptoSignatureData>;

// --- Compile-time drift checks ---

type _CryptoPrepareSignatureInputMatchesSchema = AssertSchemaToApi<
  Static<typeof CryptoPrepareSignatureSchema>,
  CryptoPrepareSignatureInput
>;
type _CryptoSubmitSignatureInputMatchesSchema = AssertSchemaToApi<
  Static<typeof CryptoSubmitSignatureSchema>,
  CryptoSubmitSignatureInput
>;
type _CryptoSigningStatusInputMatchesSchema = AssertSchemaToApi<
  Static<typeof CryptoSigningStatusSchema>,
  CryptoSigningStatusInput
>;
type _CryptoVerifyInputMatchesSchema = AssertSchemaToApi<
  Static<typeof CryptoVerifySchema>,
  CryptoVerifyInput
>;
