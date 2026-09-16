import { PI_MODEL_MODALITIES } from '@themoltnet/pi-runtime/pi-config';
import { type TSchema, Type } from 'typebox';

import { REGISTERED_TASK_TYPES } from '../help.js';

const DateTime = Type.String({ format: 'date-time' });
const StringList = Type.Array(Type.String());

/** A model the provider offers, with the input modalities it accepts. */
const ProviderModelSchema = Type.Object({
  id: Type.String(),
  input: Type.Optional(
    Type.Array(
      Type.Union(PI_MODEL_MODALITIES.map((modality) => Type.Literal(modality))),
      { minItems: 1 },
    ),
  ),
});

/** One shape on the wire, for both requests and responses. */
const ProviderModelList = Type.Array(ProviderModelSchema);

function schemaRef(schema: TSchema) {
  const id = (schema as { $id?: unknown }).$id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Agent Server protocol schemas must have an identifier');
  }
  return Type.Ref(id);
}

export const AgentServerHealthSchema = Type.Object(
  { status: Type.Literal('ok') },
  { $id: 'AgentServerHealth' },
);

export const AgentServerProblemSchema = Type.Object(
  { code: Type.String(), message: Type.String() },
  { $id: 'AgentServerProblem' },
);

export const AgentServerAgentSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal('managed'), Type.Literal('external')]),
    agentName: Type.String(),
    /** Internal `agents.id` — the durable principal. */
    subjectId: Type.String(),
    fingerprint: Type.Optional(Type.String()),
    apiUrl: Type.Optional(Type.String()),
    teamId: Type.Optional(Type.String()),
    configDir: Type.Optional(Type.String()),
    createdAt: DateTime,
    hasAgentKey: Type.Optional(Type.Boolean()),
    hasPrivateKey: Type.Optional(Type.Boolean()),
  },
  { $id: 'AgentServerAgent' },
);

export const AgentServerIdentitySchema = Type.Object(
  {
    alias: Type.String(),
    activated: Type.Boolean(),
    hasAgentKey: Type.Boolean(),
  },
  { $id: 'AgentServerIdentity' },
);

export const AgentServerTaskTypeSchema = Type.Union(
  REGISTERED_TASK_TYPES.map((taskType) => Type.Literal(taskType)),
  { $id: 'AgentServerTaskType' },
);

export const AgentServerProviderSchema = Type.Object(
  {
    api: Type.String(),
    baseUrl: Type.String({ format: 'uri' }),
    envName: Type.String(),
    models: ProviderModelList,
    hasApiKey: Type.Boolean(),
  },
  { $id: 'AgentServerProvider' },
);

export const AgentServerCatalogueTeamSchema = Type.Object(
  {
    teamId: Type.String(),
    teamName: Type.String(),
    diaries: Type.Array(
      Type.Object({ id: Type.String(), name: Type.String() }),
    ),
    /** Null when the operator must choose: several diaries, no binding. */
    defaultDiaryId: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'AgentServerCatalogueTeam' },
);

export const AgentServerCatalogueProfileSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    teamId: Type.String(),
    runtimeKind: Type.String(),
    requiredEnv: StringList,
    requiredExecutables: StringList,
    /** Whether this machine can execute the profile right now. */
    ready: Type.Boolean(),
    blockers: Type.Array(
      Type.Object({
        code: Type.String(),
        message: Type.String(),
        remedy: Type.String(),
      }),
    ),
  },
  { $id: 'AgentServerCatalogueProfile' },
);

export const AgentServerCatalogueSchema = Type.Object(
  {
    teams: Type.Array(schemaRef(AgentServerCatalogueTeamSchema)),
    defaultTeamId: Type.Union([Type.String(), Type.Null()]),
    profiles: Type.Array(schemaRef(AgentServerCatalogueProfileSchema)),
  },
  { $id: 'AgentServerCatalogue' },
);

export const CatalogueQuerySchema = Type.Object({
  /** Local alias of the identity whose teams and profiles are listed. */
  identity: Type.String({ minLength: 1 }),
});

export const AgentServerRunRecordSchema = Type.Object(
  {
    id: Type.String(),
    agent: Type.String(),
    teamId: Type.String(),
    diaryId: Type.Optional(Type.String()),
    profiles: StringList,
    taskTypes: StringList,
    mode: Type.Union([Type.Literal('poll'), Type.Literal('drain')]),
    status: Type.Union([
      Type.Literal('running'),
      Type.Literal('exited'),
      Type.Literal('stopped'),
      Type.Literal('failed'),
    ]),
    pid: Type.Optional(Type.Number()),
    exitCode: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    startedAt: DateTime,
    endedAt: Type.Optional(DateTime),
  },
  { $id: 'AgentServerRunRecord' },
);

export const AgentServerRunSchema = Type.Intersect(
  [
    schemaRef(AgentServerRunRecordSchema),
    Type.Object({ active: Type.Boolean() }),
  ],
  { $id: 'AgentServerRun' },
);

export const AgentServerSubscriptionSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    connected: Type.Boolean(),
  },
  { $id: 'AgentServerSubscription' },
);

export const AgentServerSubscriptionLoginSchema = Type.Object(
  {
    providerId: Type.String(),
    status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('completed'),
      Type.Literal('failed'),
    ]),
    authUrl: Type.Optional(Type.String({ format: 'uri' })),
    instructions: Type.Optional(Type.String()),
    userCode: Type.Optional(Type.String()),
    verificationUri: Type.Optional(Type.String({ format: 'uri' })),
    error: Type.Optional(Type.String()),
  },
  { $id: 'AgentServerSubscriptionLogin' },
);

export const AgentServerStatusSchema = Type.Object(
  {
    version: Type.String(),
    platform: Type.String(),
    subscriptions: Type.Array(schemaRef(AgentServerSubscriptionSchema)),
    agents: Type.Array(schemaRef(AgentServerAgentSchema)),
    identities: Type.Array(schemaRef(AgentServerIdentitySchema)),
    selectedIdentity: Type.Optional(Type.String()),
    providers: Type.Record(Type.String(), schemaRef(AgentServerProviderSchema)),
    runs: Type.Array(schemaRef(AgentServerRunSchema)),
    runtimeSettings: Type.Object({
      heartbeatIntervalMs: Type.Integer({ minimum: 0 }),
      warmRetentionSec: Type.Integer({ minimum: 0 }),
    }),
  },
  { $id: 'AgentServerStatus' },
);

export const PairingStartedSchema = Type.Object(
  { pairingId: Type.String(), approvalPath: Type.String() },
  { $id: 'PairingStarted' },
);

export const PairingClaimedSchema = Type.Object(
  { token: Type.String() },
  { $id: 'PairingClaimed' },
);

export const PairingParamsSchema = Type.Object({ pairingId: Type.String() });
export const ProviderParamsSchema = Type.Object({ providerId: Type.String() });
export const AgentParamsSchema = Type.Object({ agentName: Type.String() });
export const RunParamsSchema = Type.Object({ runId: Type.String() });

export const CreateAgentSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('managed'),
    name: Type.String(),
    enrollmentToken: Type.String(),
  }),
  Type.Object({
    kind: Type.Literal('external'),
    identityAlias: Type.String(),
  }),
]);

export const ReconcileAgentSchema = Type.Object({
  action: Type.Union([Type.Literal('resume'), Type.Literal('abandon')]),
});

export const ReconcileAgentResultSchema = Type.Union(
  [
    schemaRef(AgentServerAgentSchema),
    Type.Object({ abandoned: Type.Literal(true) }),
  ],
  { $id: 'ReconcileAgentResult' },
);

export const PutProviderSchema = Type.Object({
  api: Type.String(),
  baseUrl: Type.String({ format: 'uri' }),
  envName: Type.String(),
  models: ProviderModelList,
  apiKey: Type.Optional(Type.String()),
});

export const DiscoverModelsSchema = Type.Object(
  // Entries, not ids: discovery resolves input modalities, and the console
  // saves what it was given rather than re-deriving them client-side.
  { models: ProviderModelList },
  { $id: 'DiscoveredModels' },
);

export const StartRunSchema = Type.Object({
  agent: Type.String(),
  teamId: Type.String(),
  /** Paired with `teamId`; never inherited from the supervisor. */
  diaryId: Type.Optional(Type.String()),
  profiles: StringList,
  taskTypes: Type.Array(AgentServerTaskTypeSchema),
  mode: Type.Union([Type.Literal('poll'), Type.Literal('drain')]),
});

export const CancelledSubscriptionSchema = Type.Object(
  { providerId: Type.String(), status: Type.Literal('cancelled') },
  { $id: 'CancelledSubscription' },
);

export const LogStreamSchema = Type.String({
  $id: 'AgentServerLogStream',
  contentMediaType: 'text/event-stream',
});

export const AGENT_SERVER_SCHEMAS = [
  AgentServerHealthSchema,
  AgentServerProblemSchema,
  AgentServerAgentSchema,
  AgentServerIdentitySchema,
  AgentServerTaskTypeSchema,
  AgentServerProviderSchema,
  AgentServerCatalogueTeamSchema,
  AgentServerCatalogueProfileSchema,
  AgentServerCatalogueSchema,
  AgentServerRunRecordSchema,
  AgentServerRunSchema,
  AgentServerSubscriptionSchema,
  AgentServerSubscriptionLoginSchema,
  AgentServerStatusSchema,
  PairingStartedSchema,
  PairingClaimedSchema,
  ReconcileAgentResultSchema,
  DiscoverModelsSchema,
  CancelledSubscriptionSchema,
  LogStreamSchema,
] as const;

const pairedSecurity = [{ agentServerToken: [] }] as const;
const problemResponse = { default: schemaRef(AgentServerProblemSchema) };

export const AgentServerRouteSchemas = {
  health: {
    operationId: 'getAgentServerHealth',
    tags: ['system'],
    response: { 200: schemaRef(AgentServerHealthSchema) },
  },
  startPairing: {
    operationId: 'startAgentServerPairing',
    tags: ['pairing'],
    response: { 201: schemaRef(PairingStartedSchema), ...problemResponse },
  },
  claimPairing: {
    operationId: 'claimAgentServerPairing',
    tags: ['pairing'],
    params: PairingParamsSchema,
    response: { 200: schemaRef(PairingClaimedSchema), ...problemResponse },
  },
  status: {
    operationId: 'getAgentServerStatus',
    tags: ['system'],
    security: pairedSecurity,
    response: { 200: schemaRef(AgentServerStatusSchema), ...problemResponse },
  },
  listAgents: {
    operationId: 'listAgentServerAgents',
    tags: ['agents'],
    security: pairedSecurity,
    response: {
      200: Type.Array(schemaRef(AgentServerAgentSchema)),
      ...problemResponse,
    },
  },
  createAgent: {
    operationId: 'createAgentServerAgent',
    tags: ['agents'],
    security: pairedSecurity,
    body: CreateAgentSchema,
    response: { 201: schemaRef(AgentServerAgentSchema), ...problemResponse },
  },
  reconcileAgent: {
    operationId: 'reconcileAgentServerAgent',
    tags: ['agents'],
    security: pairedSecurity,
    params: AgentParamsSchema,
    body: ReconcileAgentSchema,
    response: {
      200: schemaRef(ReconcileAgentResultSchema),
      ...problemResponse,
    },
  },
  listProviders: {
    operationId: 'listAgentServerProviders',
    tags: ['providers'],
    security: pairedSecurity,
    response: {
      200: Type.Record(Type.String(), schemaRef(AgentServerProviderSchema)),
      ...problemResponse,
    },
  },
  discoverModels: {
    operationId: 'discoverAgentServerProviderModels',
    tags: ['providers'],
    security: pairedSecurity,
    params: ProviderParamsSchema,
    response: { 200: schemaRef(DiscoverModelsSchema), ...problemResponse },
  },
  putProvider: {
    operationId: 'putAgentServerProvider',
    tags: ['providers'],
    security: pairedSecurity,
    params: ProviderParamsSchema,
    body: PutProviderSchema,
    response: {
      200: schemaRef(AgentServerProviderSchema),
      ...problemResponse,
    },
  },
  deleteProvider: {
    operationId: 'deleteAgentServerProvider',
    tags: ['providers'],
    security: pairedSecurity,
    params: ProviderParamsSchema,
    response: { 204: Type.Any(), ...problemResponse },
  },
  listSubscriptions: {
    operationId: 'listAgentServerSubscriptions',
    tags: ['subscriptions'],
    security: pairedSecurity,
    response: {
      200: Type.Array(schemaRef(AgentServerSubscriptionSchema)),
      ...problemResponse,
    },
  },
  startSubscriptionLogin: {
    operationId: 'startAgentServerSubscriptionLogin',
    tags: ['subscriptions'],
    security: pairedSecurity,
    params: ProviderParamsSchema,
    response: {
      201: schemaRef(AgentServerSubscriptionLoginSchema),
      ...problemResponse,
    },
  },
  getSubscriptionLogin: {
    operationId: 'getAgentServerSubscriptionLogin',
    tags: ['subscriptions'],
    security: pairedSecurity,
    params: ProviderParamsSchema,
    response: {
      200: schemaRef(AgentServerSubscriptionLoginSchema),
      ...problemResponse,
    },
  },
  cancelSubscriptionLogin: {
    operationId: 'cancelAgentServerSubscriptionLogin',
    tags: ['subscriptions'],
    security: pairedSecurity,
    params: ProviderParamsSchema,
    response: {
      200: schemaRef(CancelledSubscriptionSchema),
      ...problemResponse,
    },
  },
  catalogue: {
    operationId: 'getAgentServerCatalogue',
    tags: ['catalogue'],
    security: pairedSecurity,
    querystring: CatalogueQuerySchema,
    response: { 200: schemaRef(AgentServerCatalogueSchema), ...problemResponse },
  },
  listRuns: {
    operationId: 'listAgentServerRuns',
    tags: ['runs'],
    security: pairedSecurity,
    response: {
      200: Type.Array(schemaRef(AgentServerRunSchema)),
      ...problemResponse,
    },
  },
  startRun: {
    operationId: 'startAgentServerRun',
    tags: ['runs'],
    security: pairedSecurity,
    body: StartRunSchema,
    response: { 201: schemaRef(AgentServerRunSchema), ...problemResponse },
  },
  stopRun: {
    operationId: 'stopAgentServerRun',
    tags: ['runs'],
    security: pairedSecurity,
    params: RunParamsSchema,
    response: {
      200: schemaRef(AgentServerRunRecordSchema),
      ...problemResponse,
    },
  },
  streamRunLogs: {
    operationId: 'streamAgentServerRunLogs',
    tags: ['runs'],
    security: pairedSecurity,
    params: RunParamsSchema,
    response: { 200: schemaRef(LogStreamSchema), ...problemResponse },
  },
} as const;
