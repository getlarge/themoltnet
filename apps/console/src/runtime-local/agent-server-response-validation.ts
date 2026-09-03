import type { Static, TSchema } from 'typebox';
import { Type } from 'typebox';
import { Value } from 'typebox/value';

const DateTimeSchema = Type.String();
const StringArraySchema = Type.Array(Type.String());

export const AgentServerAgentViewSchema = Type.Object({
  kind: Type.Union([Type.Literal('managed'), Type.Literal('external')]),
  agentName: Type.String(),
  identityId: Type.Optional(Type.String()),
  fingerprint: Type.Optional(Type.String()),
  apiUrl: Type.Optional(Type.String()),
  teamId: Type.Optional(Type.String()),
  configDir: Type.Optional(Type.String()),
  createdAt: DateTimeSchema,
  hasAgentKey: Type.Optional(Type.Boolean()),
  hasPrivateKey: Type.Optional(Type.Boolean()),
});

export const AgentServerProviderViewSchema = Type.Object({
  api: Type.String(),
  baseUrl: Type.String(),
  envName: Type.String(),
  models: StringArraySchema,
  hasApiKey: Type.Boolean(),
});

export const AgentServerRunViewSchema = Type.Object({
  id: Type.String(),
  agent: Type.String(),
  teamId: Type.String(),
  profiles: StringArraySchema,
  taskTypes: StringArraySchema,
  mode: Type.Union([Type.Literal('poll'), Type.Literal('drain')]),
  status: Type.Union([
    Type.Literal('running'),
    Type.Literal('exited'),
    Type.Literal('stopped'),
    Type.Literal('failed'),
  ]),
  pid: Type.Optional(Type.Number()),
  exitCode: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  startedAt: DateTimeSchema,
  endedAt: Type.Optional(DateTimeSchema),
  active: Type.Boolean(),
});

export const AgentServerSubscriptionViewSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  connected: Type.Boolean(),
});

export const AgentServerSubscriptionLoginSchema = Type.Object({
  providerId: Type.String(),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('completed'),
    Type.Literal('failed'),
  ]),
  authUrl: Type.Optional(Type.String()),
  instructions: Type.Optional(Type.String()),
  userCode: Type.Optional(Type.String()),
  verificationUri: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
});

export const AgentServerStatusSchema = Type.Object({
  version: Type.String(),
  platform: Type.String(),
  subscriptions: Type.Array(AgentServerSubscriptionViewSchema),
  agents: Type.Array(AgentServerAgentViewSchema),
  providers: Type.Record(Type.String(), AgentServerProviderViewSchema),
  runs: Type.Array(AgentServerRunViewSchema),
});

export const PairingStartedSchema = Type.Object({
  pairingId: Type.String(),
  approvalPath: Type.String(),
});

export const PairingClaimedSchema = Type.Object({ token: Type.String() });

export const DiscoverModelsSchema = Type.Object({
  models: StringArraySchema,
});

export const ProblemSchema = Type.Object({
  code: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
});

export function parseAgentServerResponse<T extends TSchema>(
  schema: T,
  value: unknown,
  label: string,
): Static<T> {
  if (!Value.Check(schema, value)) {
    throw new Error(`Local supervisor returned an invalid ${label} response`);
  }
  return value;
}
