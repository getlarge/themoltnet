import type { AgentServerProvider } from '@moltnet/agent-daemon-api-client';
import type { Static, TSchema } from 'typebox';
import { Type } from 'typebox';
import { Value } from 'typebox/value';

/**
 * The modality union as it appears on the wire, taken from the generated
 * client rather than restated. The daemon derives its schema from
 * `PI_MODEL_MODALITIES`; that module is a Node-only writer and cannot be
 * imported into a browser bundle, so the generated type is the shared
 * artefact both sides already agree on.
 */
type WireModality = NonNullable<
  AgentServerProvider['models'][number]['input']
>[number];

type AssertExhaustive<T extends never> = T;

const DateTimeSchema = Type.String();
const StringArraySchema = Type.Array(Type.String());

export const AgentServerAgentViewSchema = Type.Object({
  kind: Type.Union([Type.Literal('managed'), Type.Literal('external')]),
  agentName: Type.String(),
  /**
   * Internal `agents.id` — the durable principal, and what every `agentId`
   * parameter and Keto subject means. Mirrors AgentServerAgentSchema in the
   * daemon; this schema validates that response, so omitting the field here
   * silently drops it.
   */
  subjectId: Type.String(),
  fingerprint: Type.Optional(Type.String()),
  apiUrl: Type.Optional(Type.String()),
  teamId: Type.Optional(Type.String()),
  configDir: Type.Optional(Type.String()),
  createdAt: DateTimeSchema,
  hasAgentKey: Type.Optional(Type.Boolean()),
  hasPrivateKey: Type.Optional(Type.Boolean()),
});

export const AgentServerIdentityViewSchema = Type.Object({
  alias: Type.String(),
  activated: Type.Boolean(),
  hasAgentKey: Type.Boolean(),
});

/** A provider model plus the input modalities it accepts. */
export const AgentServerProviderModelSchema = Type.Object({
  id: Type.String(),
  // Mirrors the daemon's ProviderModelSchema, minItems included: an empty
  // `input` is never emitted, so accepting one here would let the console
  // validate a shape the daemon rejects.
  // Literals are spelled out so `Static<>` keeps the union; a mapped array
  // widens to never[]. `_AllModalitiesValidated` below is what guards drift.
  input: Type.Optional(
    Type.Array(Type.Union([Type.Literal('text'), Type.Literal('image')]), {
      minItems: 1,
    }),
  ),
});

/** One provider model as the console models it internally. */
export type AgentServerProviderModel = Static<
  typeof AgentServerProviderModelSchema
>;

/**
 * Fails to compile if the wire gains a modality the schema above does not
 * validate. Derived from the schema itself, so it tracks whatever that schema
 * accepts rather than a second list that could drift from it.
 */
export type _AllModalitiesValidated = AssertExhaustive<
  Exclude<WireModality, NonNullable<AgentServerProviderModel['input']>[number]>
>;

export const AgentServerProviderViewSchema = Type.Object({
  api: Type.String(),
  baseUrl: Type.String(),
  envName: Type.String(),
  models: Type.Array(AgentServerProviderModelSchema),
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
  identities: Type.Array(AgentServerIdentityViewSchema),
  selectedIdentity: Type.Optional(Type.String()),
  providers: Type.Record(Type.String(), AgentServerProviderViewSchema),
  runtimeSettings: Type.Optional(
    Type.Object({
      heartbeatIntervalMs: Type.Integer({ minimum: 0 }),
      warmRetentionSec: Type.Integer({ minimum: 0, maximum: 86_400 }),
    }),
  ),
  runs: Type.Array(AgentServerRunViewSchema),
});

export const DiscoverModelsSchema = Type.Object({
  // The daemon resolves input modalities during discovery; the console saves
  // what it was handed rather than re-deriving them here.
  models: Type.Array(AgentServerProviderModelSchema),
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

export function parseAgentServerStatus(value: unknown) {
  const status = parseAgentServerResponse(
    AgentServerStatusSchema,
    value,
    'status',
  );
  return {
    ...status,
    runtimeSettings: status.runtimeSettings ?? {
      heartbeatIntervalMs: 60_000,
      warmRetentionSec: 1800,
    },
  };
}
