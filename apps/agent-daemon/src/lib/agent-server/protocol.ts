import { ProjectResponseSchema } from '@moltnet/models';
import { RuntimeProfile } from '@moltnet/runtime-profiles';
import { PI_MODEL_MODALITIES } from '@themoltnet/pi-runtime/pi-config';
import { type TSchema, Type } from 'typebox';

import { REGISTERED_TASK_TYPES } from '../help.js';
import { PROFILE_DEFAULT_STRATEGY } from './store.js';

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

const CredentialMetadataSchema = Type.Object({
  keyId: Type.String(),
  expiresAt: Type.Optional(Type.Union([DateTime, Type.Null()])),
  verifiedAt: DateTime,
  scopes: StringList,
});

export const AgentServerCatalogueTeamSchema = Type.Object(
  {
    teamId: Type.String(),
    teamName: Type.String(),
    available: Type.Boolean(),
    credential: Type.Optional(CredentialMetadataSchema),
    blockers: Type.Array(
      Type.Object({
        code: Type.String(),
        message: Type.String(),
        remedy: Type.String(),
      }),
    ),
    diaries: Type.Array(
      Type.Object({ id: Type.String(), name: Type.String() }),
    ),
    /** Null when the operator must choose: several diaries, no binding. */
    defaultDiaryId: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'AgentServerCatalogueTeam' },
);

/**
 * Composed from the canonical `RuntimeProfile` schema rather than restated, so
 * the wire contract cannot drift from the profile the API serves — and so the
 * constrained fields keep their real unions instead of degrading to `string`.
 */
export const AgentServerCatalogueProfileSchema = Type.Intersect(
  [
    Type.Pick(RuntimeProfile, [
      'id',
      'name',
      'teamId',
      'description',
      'provider',
      'model',
      'runtimeKind',
      'toolEnforcement',
      'defaultWorkspaceMode',
      'maxTurns',
      'revision',
      'definitionCid',
      'requiredEnv',
      'requiredTools',
      'requiredExecutables',
    ]),
    Type.Object({
      /** Whether this machine can execute the profile right now. */
      ready: Type.Boolean(),
      blockers: Type.Array(
        Type.Object({
          code: Type.String(),
          message: Type.String(),
          remedy: Type.String(),
        }),
      ),
    }),
  ],
  { $id: 'AgentServerCatalogueProfile' },
);

export const AgentServerCatalogueSchema = Type.Object(
  {
    teams: Type.Array(schemaRef(AgentServerCatalogueTeamSchema)),
    defaultTeamId: Type.Union([Type.String(), Type.Null()]),
    profiles: Type.Array(schemaRef(AgentServerCatalogueProfileSchema)),
    projects: Type.Array(
      Type.Pick(ProjectResponseSchema, [
        'id',
        'teamId',
        'name',
        'description',
        'defaultDiaryId',
        'archived',
      ]),
    ),
    projectErrors: Type.Array(
      Type.Object({
        teamId: Type.String(),
        code: Type.Union(
          ['forbidden', 'unreachable', 'invalid_response', 'truncated'].map(
            (value) => Type.Literal(value),
          ),
        ),
        message: Type.String(),
      }),
    ),
  },
  { $id: 'AgentServerCatalogue' },
);

export const CatalogueQuerySchema = Type.Object({
  /** Local alias of the identity whose teams and profiles are listed. */
  identity: Type.String({ minLength: 1 }),
  /** Skip the shared read and verify every team now, for explicit refreshes. */
  refresh: Type.Optional(Type.Boolean()),
});

export const AgentServerProjectLocationSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    apiUrl: Type.String(),
    teamId: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    diaryId: Type.Optional(Type.String({ minLength: 1 })),
    source: Type.Optional(Type.String({ minLength: 1 })),
    strategy: Type.Union(
      ['none', 'existing', 'git-worktree', 'isolated-directory'].map((value) =>
        Type.Literal(value),
      ),
    ),
    default: Type.Optional(Type.Boolean()),
    effectiveSource: Type.Union([Type.String(), Type.Null()]),
    readiness: Type.Object({
      ready: Type.Boolean(),
      code: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
    }),
  },
  { $id: 'AgentServerProjectLocation' },
);

/** Closed: hooks and other stored fields are never writable over this route. */
const SaveProjectLocationSchema = Type.Object(
  {
    identity: Type.String({ minLength: 1 }),
    teamId: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    diaryId: Type.Optional(Type.String({ minLength: 1 })),
    source: Type.Optional(Type.String({ minLength: 1 })),
    strategy: Type.Union(
      ['none', 'existing', 'git-worktree'].map((value) => Type.Literal(value)),
    ),
    default: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const ProjectLocationParamsSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
});

/** Local project selection on a run request; only the native client may set these. */
const RunProjectFields = {
  projectId: Type.Optional(
    Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  ),
  /** A saved location by name, as in the project-locations API. */
  location: Type.Optional(Type.String({ minLength: 1 })),
  source: Type.Optional(Type.String({ minLength: 1 })),
  strategy: Type.Optional(AgentServerProjectLocationSchema.properties.strategy),
};
/** Claim filters and timing controls shared by run requests and stored records. */
const RunClaimFields = {
  diaryId: Type.Optional(
    Type.String({
      description:
        'Diary context for the worker to write to; this does not filter task claims.',
    }),
  ),
  correlationId: Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Claim only tasks with this orchestration correlation ID.',
    }),
  ),
  diaryIds: Type.Optional(
    Type.Array(Type.String({ format: 'uuid' }), {
      minItems: 1,
      maxItems: 32,
      description: 'Claim only tasks belonging to these diaries.',
    }),
  ),
  pollIntervalMs: Type.Optional(
    Type.Integer({
      minimum: 250,
      maximum: 3_600_000,
      description: 'Idle polling backoff floor in milliseconds. Default: 2000.',
    }),
  ),
  maxPollIntervalMs: Type.Optional(
    Type.Integer({
      minimum: 250,
      maximum: 3_600_000,
      description:
        'Idle polling backoff ceiling in milliseconds. Default: 30000.',
    }),
  ),
  waitForFirstTaskSec: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 86_400,
      description:
        'In drain mode, wait up to this many seconds for the first matching task. Default: 0.',
    }),
  ),
  waitAfterTaskSec: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 86_400,
      description:
        'In drain mode, require the queue to stay empty this many seconds after a claim. Default: 0.',
    }),
  ),
};
/** Names gated to the native client; derived so a new field is gated automatically. */
export const NATIVE_RUN_FIELDS = Object.keys(RunProjectFields) as Array<
  keyof typeof RunProjectFields
>;
/** What a run resolved to; the record's top-level fields stay as requested. */
const RunWorkspaceSchema = Type.Object({
  projectId: Type.Union([Type.String(), Type.Null()]),
  location: Type.Optional(Type.String()),
  diaryId: Type.Optional(Type.String()),
  source: Type.Optional(Type.String()),
  strategy: Type.Union([
    AgentServerProjectLocationSchema.properties.strategy,
    Type.Literal(PROFILE_DEFAULT_STRATEGY),
  ]),
});

export const AgentServerRunRecordSchema = Type.Object(
  {
    ...RunProjectFields,
    workspace: Type.Optional(RunWorkspaceSchema),
    id: Type.String(),
    agent: Type.String(),
    teamId: Type.String(),
    ...RunClaimFields,
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
    credential: Type.Optional(CredentialMetadataSchema),
    /** Why the run stopped. Present only on a failed run. */
    lastError: Type.Optional(
      Type.Object({ code: Type.String(), message: Type.String() }),
    ),
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
    teamId: Type.Optional(Type.String({ format: 'uuid' })),
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
  ...RunProjectFields,
  agent: Type.String(),
  teamId: Type.String(),
  /** Paired with `teamId`; never inherited from the supervisor. */
  ...RunClaimFields,
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
  AgentServerProjectLocationSchema,
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
  ReconcileAgentResultSchema,
  DiscoverModelsSchema,
  CancelledSubscriptionSchema,
  LogStreamSchema,
] as const;

const localControlSecurity = [{ agentServerToken: [] }] as const;
const problemResponse = { default: schemaRef(AgentServerProblemSchema) };
const RecoveryParamsSchema = Type.Object({
  agentName: Type.String(),
  recoveryId: Type.String({
    pattern:
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]json$',
  }),
});

export const AgentServerRouteSchemas = {
  listProjectLocations: {
    operationId: 'listNativeProjectLocations',
    tags: ['native-projects'],
    security: localControlSecurity,
    description:
      'Requires the Desktop native grant; browser authorization is insufficient.',
    response: {
      200: Type.Object({
        locations: Type.Array(schemaRef(AgentServerProjectLocationSchema)),
      }),
      ...problemResponse,
    },
  },
  saveProjectLocation: {
    operationId: 'saveNativeProjectLocation',
    tags: ['native-projects'],
    security: localControlSecurity,
    description:
      'Creates or replaces the named location. Requires the Desktop native grant.',
    params: ProjectLocationParamsSchema,
    body: SaveProjectLocationSchema,
    response: {
      200: schemaRef(AgentServerProjectLocationSchema),
      ...problemResponse,
    },
  },
  removeProjectLocation: {
    operationId: 'removeNativeProjectLocation',
    tags: ['native-projects'],
    security: localControlSecurity,
    description:
      'Removes the registration only; the folder is left untouched. Requires the Desktop native grant.',
    params: ProjectLocationParamsSchema,
    response: {
      200: Type.Object({ removed: Type.Boolean() }),
      ...problemResponse,
    },
  },
  health: {
    operationId: 'getAgentServerHealth',
    tags: ['system'],
    response: { 200: schemaRef(AgentServerHealthSchema) },
  },
  status: {
    operationId: 'getAgentServerStatus',
    tags: ['system'],
    security: localControlSecurity,
    response: { 200: schemaRef(AgentServerStatusSchema), ...problemResponse },
  },
  listAgents: {
    operationId: 'listAgentServerAgents',
    tags: ['agents'],
    security: localControlSecurity,
    response: {
      200: Type.Array(schemaRef(AgentServerAgentSchema)),
      ...problemResponse,
    },
  },
  createAgent: {
    operationId: 'createAgentServerAgent',
    tags: ['agents'],
    security: localControlSecurity,
    body: CreateAgentSchema,
    response: { 201: schemaRef(AgentServerAgentSchema), ...problemResponse },
  },
  enrollTeam: {
    operationId: 'enrollAgentServerTeam',
    tags: ['agents'],
    security: localControlSecurity,
    params: AgentParamsSchema,
    body: Type.Intersect([
      Type.Object({
        teamId: Type.String({ format: 'uuid' }),
        idempotencyKey: Type.String({ minLength: 1, maxLength: 256 }),
        scopes: Type.Optional(
          Type.Array(Type.String(), { minItems: 1, uniqueItems: true }),
        ),
      }),
      Type.Union([
        Type.Object({ mode: Type.Literal('enroll') }),
        Type.Object({
          mode: Type.Literal('replace'),
        }),
      ]),
    ]),
    response: {
      200: Type.Union([
        Type.Object({
          state: Type.Literal('persisted'),
          teamId: Type.String(),
          keyId: Type.String(),
          scopes: Type.Array(Type.String()),
        }),
        Type.Object({
          state: Type.Literal('retryable'),
          retryAfter: Type.Optional(Type.Number()),
          message: Type.String(),
        }),
        Type.Object({
          state: Type.Literal('recovery_required'),
          secretCaptured: Type.Boolean(),
          issuedKeyId: Type.Optional(Type.String()),
          recoveryId: Type.String(),
          message: Type.String(),
        }),
      ]),
      ...problemResponse,
    },
  },
  listEnrollmentRecoveries: {
    operationId: 'listAgentServerEnrollmentRecoveries',
    tags: ['agents'],
    security: localControlSecurity,
    params: AgentParamsSchema,
    response: {
      200: Type.Object({
        items: Type.Array(
          Type.Object({
            recoveryId: Type.String(),
            secretCaptured: Type.Boolean(),
            teamId: Type.Optional(Type.String()),
            keyId: Type.Optional(Type.String()),
            operation: Type.Optional(Type.String()),
            createdAt: DateTime,
          }),
        ),
      }),
      ...problemResponse,
    },
  },
  restoreEnrollment: {
    operationId: 'restoreAgentServerEnrollment',
    tags: ['agents'],
    security: localControlSecurity,
    params: RecoveryParamsSchema,
    response: {
      200: Type.Object({
        state: Type.Literal('persisted'),
        teamId: Type.String(),
        keyId: Type.String(),
      }),
      ...problemResponse,
    },
  },
  discardEnrollmentRecovery: {
    operationId: 'discardAgentServerEnrollmentRecovery',
    tags: ['agents'],
    security: localControlSecurity,
    params: RecoveryParamsSchema,
    body: Type.Object({ expectedSecretCaptured: Type.Boolean() }),
    response: {
      200: Type.Object({ state: Type.Literal('discarded') }),
      ...problemResponse,
    },
  },
  reconcileAgent: {
    operationId: 'reconcileAgentServerAgent',
    tags: ['agents'],
    security: localControlSecurity,
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
    security: localControlSecurity,
    response: {
      200: Type.Record(Type.String(), schemaRef(AgentServerProviderSchema)),
      ...problemResponse,
    },
  },
  discoverModels: {
    operationId: 'discoverAgentServerProviderModels',
    tags: ['providers'],
    security: localControlSecurity,
    params: ProviderParamsSchema,
    response: { 200: schemaRef(DiscoverModelsSchema), ...problemResponse },
  },
  putProvider: {
    operationId: 'putAgentServerProvider',
    tags: ['providers'],
    security: localControlSecurity,
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
    security: localControlSecurity,
    params: ProviderParamsSchema,
    response: { 204: Type.Any(), ...problemResponse },
  },
  listSubscriptions: {
    operationId: 'listAgentServerSubscriptions',
    tags: ['subscriptions'],
    security: localControlSecurity,
    response: {
      200: Type.Array(schemaRef(AgentServerSubscriptionSchema)),
      ...problemResponse,
    },
  },
  startSubscriptionLogin: {
    operationId: 'startAgentServerSubscriptionLogin',
    tags: ['subscriptions'],
    security: localControlSecurity,
    params: ProviderParamsSchema,
    response: {
      201: schemaRef(AgentServerSubscriptionLoginSchema),
      ...problemResponse,
    },
  },
  getSubscriptionLogin: {
    operationId: 'getAgentServerSubscriptionLogin',
    tags: ['subscriptions'],
    security: localControlSecurity,
    params: ProviderParamsSchema,
    response: {
      200: schemaRef(AgentServerSubscriptionLoginSchema),
      ...problemResponse,
    },
  },
  cancelSubscriptionLogin: {
    operationId: 'cancelAgentServerSubscriptionLogin',
    tags: ['subscriptions'],
    security: localControlSecurity,
    params: ProviderParamsSchema,
    response: {
      200: schemaRef(CancelledSubscriptionSchema),
      ...problemResponse,
    },
  },
  catalogue: {
    operationId: 'getAgentServerCatalogue',
    tags: ['catalogue'],
    security: localControlSecurity,
    querystring: CatalogueQuerySchema,
    response: {
      200: schemaRef(AgentServerCatalogueSchema),
      ...problemResponse,
    },
  },
  listRuns: {
    operationId: 'listAgentServerRuns',
    tags: ['runs'],
    security: localControlSecurity,
    response: {
      200: Type.Array(schemaRef(AgentServerRunSchema)),
      ...problemResponse,
    },
  },
  startRun: {
    operationId: 'startAgentServerRun',
    tags: ['runs'],
    security: localControlSecurity,
    description:
      'projectId (other than null), location, source and strategy are native-only: other origins receive 403 native_required. A request naming none of them runs without project workspace wiring. The record keeps these fields as requested; resolved values are in `workspace`.',
    body: StartRunSchema,
    response: { 201: schemaRef(AgentServerRunSchema), ...problemResponse },
  },
  stopRun: {
    operationId: 'stopAgentServerRun',
    tags: ['runs'],
    security: localControlSecurity,
    params: RunParamsSchema,
    response: {
      200: schemaRef(AgentServerRunRecordSchema),
      ...problemResponse,
    },
  },
  streamRunLogs: {
    operationId: 'streamAgentServerRunLogs',
    tags: ['runs'],
    security: localControlSecurity,
    params: RunParamsSchema,
    response: { 200: schemaRef(LogStreamSchema), ...problemResponse },
  },
} as const;
