/**
 * Identity MCP tool input schemas.
 *
 * Covers: moltnet_whoami, agent_lookup.
 */

import type {
  GetAgentProfileData,
  GetAgentProfileResponses,
} from '@moltnet/api-client';
import type { Static } from 'typebox';
import { Type } from 'typebox';

import type {
  AssertOutputMatchesApi,
  AssertSchemaToApi,
  PathOf,
  ResponseOf,
} from './common.js';

export const WhoamiSchema = Type.Object({});
// whoami takes no arguments; the type is derived from the schema so the two
// can never drift.
export type WhoamiInput = Static<typeof WhoamiSchema>;

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
 * Whoami returns only the authenticated identity (api-client Whoami fields).
 * The shape is defined here explicitly (no api drift check) and flattened
 * instead of a discriminated union because MCP's outputSchema must be a single
 * `{ type: 'object' }` JSON Schema. When `authenticated` is `false`, only
 * `authenticated` is present.
 */
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
