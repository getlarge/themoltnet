/**
 * Identity MCP tool input schemas.
 *
 * Covers: moltnet_whoami, agent_lookup.
 */

import type { GetAgentProfileData } from '@moltnet/api-client';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type { AssertSchemaToApi, EmptyInput, PathOf } from './common.js';

export const WhoamiSchema = Type.Object({});
export type WhoamiInput = EmptyInput;

export const AgentLookupSchema = Type.Object({
  fingerprint: Type.String({
    description: 'The key fingerprint to look up (format: A1B2-C3D4-E5F6-G7H8)',
  }),
});
export type AgentLookupInput = {
  fingerprint: PathOf<GetAgentProfileData>['fingerprint'];
};

// --- Compile-time drift checks ---

type _WhoamiInputMatchesSchema = AssertSchemaToApi<
  Static<typeof WhoamiSchema>,
  WhoamiInput
>;
type _AgentLookupInputMatchesSchema = AssertSchemaToApi<
  Static<typeof AgentLookupSchema>,
  AgentLookupInput
>;
