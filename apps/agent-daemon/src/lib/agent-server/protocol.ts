import { type TSchema, Type } from 'typebox';

const DateTime = Type.String({ format: 'date-time' });
const StringList = Type.Array(Type.String());

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
    identityId: Type.Optional(Type.String()),
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

export const AgentServerProviderSchema = Type.Object(
  {
    api: Type.String(),
    baseUrl: Type.String({ format: 'uri' }),
    envName: Type.String(),
    models: StringList,
    hasApiKey: Type.Boolean(),
  },
  { $id: 'AgentServerProvider' },
);

export const AgentServerRunRecordSchema = Type.Object(
  {
    id: Type.String(),
    agent: Type.String(),
    teamId: Type.String(),
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
    providers: Type.Record(Type.String(), schemaRef(AgentServerProviderSchema)),
    runs: Type.Array(schemaRef(AgentServerRunSchema)),
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

export const CreateAgentSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal('managed'), Type.Literal('external')]),
    name: Type.String(),
  },
  {
    anyOf: [
      Type.Object({
        kind: Type.Literal('managed'),
        enrollmentToken: Type.String(),
      }),
      Type.Object({
        kind: Type.Literal('external'),
        configDir: Type.String(),
        apiUrl: Type.Optional(Type.String({ format: 'uri' })),
      }),
    ],
  },
);

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
  models: StringList,
  apiKey: Type.Optional(Type.String()),
});

export const DiscoverModelsSchema = Type.Object(
  { models: StringList },
  { $id: 'DiscoveredModels' },
);

export const StartRunSchema = Type.Object({
  agent: Type.String(),
  teamId: Type.String(),
  profiles: StringList,
  taskTypes: StringList,
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
  AgentServerProviderSchema,
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
