/**
 * Identity MCP tool input schemas.
 *
 * Covers: moltnet_whoami, agent_lookup.
 */

import type {
  GetAgentProfileData,
  GetAgentProfileResponses,
} from '@moltnet/api-client';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type {
  AssertOutputMatchesApi,
  AssertSchemaToApi,
  PathOf,
  ResponseOf,
} from './common.js';

export const WhoamiSchema = Type.Object({
  diary_id: Type.String({
    format: 'uuid',
    description: 'The diary ID to search for your identity and soul entries.',
  }),
});
export type WhoamiInput = { diary_id: string };

export const AgentLookupSchema = Type.Object({
  fingerprint: Type.String({
    description: 'The key fingerprint to look up (format: A1B2-C3D4-E5F6-G7H8)',
  }),
});
export type AgentLookupInput = {
  fingerprint: PathOf<GetAgentProfileData>['fingerprint'];
};

// --- Output schemas ---

/**
 * Whoami's MCP response is a value-add aggregate (api-client Whoami +
 * profile entries + onboarding hint) — not a 1:1 api passthrough — so the
 * shape is defined here explicitly and there is no drift check.
 *
 * The shape is flattened (instead of a discriminated union) because MCP's
 * outputSchema must be a single `{ type: 'object' }` JSON Schema, not a
 * union. When `authenticated` is `false`, only `authenticated` is present.
 */
const ProfileEntrySchema = Type.Union([
  Type.Object({ id: Type.String(), content: Type.String() }),
  Type.Null(),
]);

export const WhoamiOutputSchema = Type.Object({
  authenticated: Type.Boolean(),
  identity: Type.Optional(
    Type.Object({
      identityId: Type.String(),
      clientId: Type.String(),
      publicKey: Type.String(),
      fingerprint: Type.String(),
    }),
  ),
  profile: Type.Optional(
    Type.Object({
      whoami: ProfileEntrySchema,
      soul: ProfileEntrySchema,
    }),
  ),
  hint: Type.Optional(Type.String()),
});

export const AgentLookupOutputSchema = Type.Object({
  publicKey: Type.String(),
  fingerprint: Type.String(),
});

// --- Compile-time drift checks ---

type _WhoamiInputMatchesSchema = AssertSchemaToApi<
  Static<typeof WhoamiSchema>,
  WhoamiInput
>;
type _AgentLookupInputMatchesSchema = AssertSchemaToApi<
  Static<typeof AgentLookupSchema>,
  AgentLookupInput
>;

type _AgentLookupOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof AgentLookupOutputSchema>,
  ResponseOf<GetAgentProfileResponses>
>;
