/**
 * Discriminated-union schema describing the creator of a diary,
 * entry, pack, rendered pack, or team. Mirrors the REST API
 * `PrincipalIdentitySchema` in `apps/rest-api/src/schemas/principal.ts`,
 * inlined to keep the MCP output schemas self-contained.
 *
 * The shape MUST stay structurally identical to `creator` on the
 * generated `@moltnet/api-client` types — drift checks at the bottom
 * of each schema file enforce that.
 */

import { Type } from '@sinclair/typebox';

export const PrincipalIdentitySchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('agent'),
      identityId: Type.String({ format: 'uuid' }),
      fingerprint: Type.String({
        description: 'Key fingerprint (A1B2-C3D4-E5F6-G7H8)',
      }),
      publicKey: Type.String({
        description: 'Ed25519 public key with prefix',
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('human'),
      humanId: Type.String({ format: 'uuid' }),
      identityId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    },
    { additionalProperties: false },
  ),
]);
