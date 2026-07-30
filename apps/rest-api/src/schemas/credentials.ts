/**
 * @moltnet/rest-api — Credential-ladder schemas
 *
 * The MoltNet JWKS document. MoltNet signs task credentials with a MoltNet-held
 * Ed25519 key, so relying parties verify them offline against this document.
 */

import { Type } from 'typebox';

/**
 * One published Ed25519 verification key.
 *
 * `additionalProperties: false` is load-bearing on the way out: Fastify
 * serializes only the declared members, so private key material (`d`) can never
 * reach the wire even if a caller upstream handed us a private JWK.
 */
export const CredentialJwkSchema = Type.Object(
  {
    kty: Type.Literal('OKP'),
    crv: Type.Literal('Ed25519'),
    x: Type.String({ minLength: 1 }),
    kid: Type.String({ minLength: 1 }),
    alg: Type.Literal('EdDSA'),
    use: Type.Literal('sig'),
  },
  { $id: 'CredentialJwk', additionalProperties: false },
);

export const CredentialJwksSchema = Type.Object(
  {
    /**
     * Active key first, then any key still inside the maximum credential
     * lifetime. Resolve by `kid`; refresh on an unknown `kid`.
     */
    keys: Type.Array(Type.Ref(CredentialJwkSchema.$id)),
  },
  { $id: 'CredentialJwks' },
);

export const credentialSchemas = [CredentialJwkSchema, CredentialJwksSchema];
