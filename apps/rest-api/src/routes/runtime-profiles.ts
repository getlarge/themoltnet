import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import { computeJsonCid } from '@moltnet/crypto-service';
import type { RuntimeProfile as RuntimeProfile } from '@moltnet/database';
import { UniqueViolationError } from '@moltnet/database';
import {
  ConflictProblemDetailsSchema,
  ProblemDetailsSchema,
  TeamHeaderOptionalSchema,
} from '@moltnet/models';
import {
  DEFAULT_RUNTIME_PROFILE_PRESET,
  type RuntimeProfilePreset,
  type RuntimeProfileWorkspaceMode,
} from '@moltnet/tasks';
import {
  RuntimeProfile as RuntimeProfileSchema,
  type RuntimeProfileThinkingLevel,
} from '@moltnet/tasks';
import type { FastifyInstance } from 'fastify';
import { type Static, Type } from 'typebox';

import {
  createConflictProblem,
  createProblem,
  createValidationProblem,
} from '../problems/index.js';
import {
  CreateRuntimeProfileBodySchema,
  RuntimeProfileListResponseSchema,
  UpdateRuntimeProfileBodySchema,
} from '../schemas.js';
import { authContextToCreator } from '../utils/auth-principal.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';

const ProfileParamsSchema = Type.Object(
  { profileId: Type.String({ format: 'uuid' }) },
  { $id: 'RuntimeProfileParams' },
);

function authSubject(request: {
  authContext: {
    identityId: string;
    subjectType: 'agent' | 'human';
    currentTeamId: string | null;
  } | null;
}) {
  const auth = request.authContext;
  if (!auth)
    throw createProblem('unauthorized', 'Authentication context missing');
  return {
    identityId: auth.identityId,
    subjectNs:
      auth.subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent,
  };
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((v) => v.trim()).filter(Boolean))];
}

const DEFAULT_ALLOWED_WORKSPACE_MODES: RuntimeProfileWorkspaceMode[] = [
  'none',
  'shared_mount',
  'dedicated_worktree',
];

function normalizeWorkspaceModes(
  values: readonly RuntimeProfileWorkspaceMode[] | undefined,
): RuntimeProfileWorkspaceMode[] {
  return [...new Set(values ?? DEFAULT_ALLOWED_WORKSPACE_MODES)];
}

function validateWorkspacePolicy(input: {
  defaultWorkspaceMode: RuntimeProfileWorkspaceMode | null;
  allowedWorkspaceModes: readonly RuntimeProfileWorkspaceMode[];
}): void {
  if (
    input.defaultWorkspaceMode &&
    !input.allowedWorkspaceModes.includes(input.defaultWorkspaceMode)
  ) {
    throw createValidationProblem(
      [
        {
          field: 'defaultWorkspaceMode',
          message:
            'defaultWorkspaceMode must be included in allowedWorkspaceModes',
        },
      ],
      'Invalid runtime profile workspace policy',
    );
  }
}

function validatePresetPolicy(input: {
  preset: RuntimeProfilePreset;
  defaultWorkspaceMode: RuntimeProfileWorkspaceMode | null;
  allowedWorkspaceModes: readonly RuntimeProfileWorkspaceMode[];
  maxTurns: number;
}): void {
  if (input.preset !== 'interactive-direct@v1') return;
  const directWorkspaceOnly =
    input.allowedWorkspaceModes.length === 1 &&
    input.allowedWorkspaceModes[0] === 'none' &&
    (input.defaultWorkspaceMode === null ||
      input.defaultWorkspaceMode === 'none');
  if (!directWorkspaceOnly) {
    throw createValidationProblem(
      [
        {
          field: 'allowedWorkspaceModes',
          message:
            'interactive-direct@v1 requires allowedWorkspaceModes to be exactly ["none"] and an unset or none defaultWorkspaceMode',
        },
      ],
      'Invalid interactive runtime profile policy',
    );
  }
  if (input.maxTurns > 3) {
    throw createValidationProblem(
      [
        {
          field: 'maxTurns',
          message: 'interactive-direct@v1 permits at most three turns',
        },
      ],
      'Invalid interactive runtime profile policy',
    );
  }
}

async function validateRuntimeProfileModelOptions(request: {
  body: unknown;
}): Promise<void> {
  if (!isRecord(request.body)) return;

  const errors: Array<{ field: string; message: string }> = [];
  validateNullableNumberOption({
    body: request.body,
    errors,
    field: 'temperature',
    min: 0,
    max: 2,
  });
  validateNullableNumberOption({
    body: request.body,
    errors,
    field: 'topP',
    min: 0,
    max: 1,
  });
  validateNullableNumberOption({
    body: request.body,
    errors,
    field: 'topK',
    min: 1,
    max: 10_000,
    integer: true,
  });
  validateNullableNumberOption({
    body: request.body,
    errors,
    field: 'maxOutputTokens',
    min: 1,
    max: 1_000_000,
    integer: true,
  });

  if (errors.length > 0) {
    throw createValidationProblem(
      errors,
      'Invalid runtime profile model options',
    );
  }
}

function validateNullableNumberOption(args: {
  body: Record<string, unknown>;
  errors: Array<{ field: string; message: string }>;
  field: string;
  min: number;
  max: number;
  integer?: boolean;
}): void {
  if (!Object.hasOwn(args.body, args.field)) return;

  const value = args.body[args.field];
  if (value === null || value === undefined) return;
  const valid =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= args.min &&
    value <= args.max &&
    (!args.integer || Number.isInteger(value));
  if (valid) return;

  args.errors.push({
    field: args.field,
    message: `${args.field} must be ${args.integer ? 'an integer' : 'a number'} between ${args.min} and ${args.max}, or null`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeProfile(
  row: RuntimeProfile,
): Static<typeof RuntimeProfileSchema> {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    description: row.description ?? null,
    preset: row.preset as RuntimeProfilePreset,
    provider: row.provider,
    model: row.model,
    thinkingLevel:
      (row.thinkingLevel as RuntimeProfileThinkingLevel | null) ?? null,
    temperature: row.temperature ?? null,
    topP: row.topP ?? null,
    topK: row.topK ?? null,
    maxOutputTokens: row.maxOutputTokens ?? null,
    runtimeKind: 'gondolin_pi',
    sandbox: row.sandbox as Record<string, unknown>,
    sessionStorageMode: 'local',
    workspaceStorageMode: 'local',
    defaultWorkspaceMode:
      (row.defaultWorkspaceMode as RuntimeProfileWorkspaceMode | null) ?? null,
    allowedWorkspaceModes:
      row.allowedWorkspaceModes as RuntimeProfileWorkspaceMode[],
    sessionTtlSec: row.sessionTtlSec,
    workspaceTtlSec: row.workspaceTtlSec,
    leaseTtlSec: row.leaseTtlSec,
    heartbeatIntervalMs: row.heartbeatIntervalMs,
    maxBatchSize: row.maxBatchSize,
    maxTurns: row.maxTurns,
    maxBashTimeouts: row.maxBashTimeouts,
    requiredEnv: row.requiredEnv,
    requiredTools: row.requiredTools,
    context: row.context as Static<typeof RuntimeProfileSchema>['context'],
    revision: row.revision,
    definitionCid: row.definitionCid,
    createdByAgentId: row.createdByAgentId ?? null,
    createdByHumanId: row.createdByHumanId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type ProfileDefinitionInput = {
  name: string;
  description?: string | null;
  preset?: RuntimeProfilePreset;
  provider: string;
  model: string;
  thinkingLevel?: RuntimeProfileThinkingLevel | null;
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxOutputTokens?: number | null;
  runtimeKind?: 'gondolin_pi';
  sandbox: unknown;
  sessionStorageMode?: 'local';
  workspaceStorageMode?: 'local';
  defaultWorkspaceMode?: RuntimeProfileWorkspaceMode | null;
  allowedWorkspaceModes?: RuntimeProfileWorkspaceMode[];
  sessionTtlSec?: number;
  workspaceTtlSec?: number;
  leaseTtlSec?: number;
  heartbeatIntervalMs?: number;
  maxBatchSize?: number;
  maxTurns?: number;
  maxBashTimeouts?: number;
  requiredEnv?: string[];
  requiredTools?: string[];
  context?: unknown[];
};

async function computeProfileDefinitionCid(
  input: ProfileDefinitionInput,
): Promise<string> {
  return computeJsonCid({
    v: 'moltnet:runtime-profile:v2',
    name: input.name,
    description: input.description ?? null,
    preset: input.preset ?? DEFAULT_RUNTIME_PROFILE_PRESET,
    provider: input.provider.toLowerCase(),
    model: input.model.toLowerCase(),
    thinkingLevel: input.thinkingLevel ?? null,
    temperature: input.temperature ?? null,
    topP: input.topP ?? null,
    topK: input.topK ?? null,
    maxOutputTokens: input.maxOutputTokens ?? null,
    runtimeKind: input.runtimeKind ?? 'gondolin_pi',
    sandbox: input.sandbox,
    sessionStorageMode: input.sessionStorageMode ?? 'local',
    workspaceStorageMode: input.workspaceStorageMode ?? 'local',
    defaultWorkspaceMode: input.defaultWorkspaceMode ?? null,
    allowedWorkspaceModes: normalizeWorkspaceModes(input.allowedWorkspaceModes),
    sessionTtlSec: input.sessionTtlSec ?? 1800,
    workspaceTtlSec: input.workspaceTtlSec ?? 1800,
    leaseTtlSec: input.leaseTtlSec ?? 300,
    heartbeatIntervalMs: input.heartbeatIntervalMs ?? 60_000,
    maxBatchSize: input.maxBatchSize ?? 50,
    maxTurns: input.maxTurns ?? 0,
    maxBashTimeouts: input.maxBashTimeouts ?? 3,
    requiredEnv: normalizeList(input.requiredEnv).sort(),
    requiredTools: normalizeList(input.requiredTools).sort(),
    context: input.context ?? [],
  });
}

export async function runtimeProfileRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  server.get(
    '/runtime-profiles',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'listRuntimeProfiles',
        tags: ['runtime-profiles'],
        description: 'List runtime profiles for the active team context.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderOptionalSchema,
        response: {
          200: Type.Ref(RuntimeProfileListResponseSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request, 'runtime profiles');
      const { identityId, subjectNs } = authSubject(request);
      const canAccess = await fastify.permissionChecker.canAccessTeam(
        teamId,
        identityId,
        subjectNs,
      );
      if (!canAccess) throw createProblem('not-found');
      const rows = await fastify.runtimeProfileRepository.listByTeamId(teamId);
      return { items: rows.map(serializeProfile) };
    },
  );

  server.post(
    '/runtime-profiles',
    {
      preValidation: validateRuntimeProfileModelOptions,
      schema: {
        operationId: 'createRuntimeProfile',
        tags: ['runtime-profiles'],
        description: 'Create a runtime profile for the active team context.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderOptionalSchema,
        body: Type.Ref(CreateRuntimeProfileBodySchema.$id),
        response: {
          201: Type.Ref(RuntimeProfileSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const teamId = requireCurrentTeamId(request, 'runtime profiles');
      const { identityId, subjectNs } = authSubject(request);
      const canManage = await fastify.permissionChecker.canManageTeamRuntime(
        teamId,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');
      const team = await fastify.teamRepository.findById(teamId);
      if (!team) throw createProblem('not-found');
      const creator = authContextToCreator(request);
      const body = request.body as Static<
        typeof CreateRuntimeProfileBodySchema
      >;
      const workspacePolicy = {
        defaultWorkspaceMode: body.defaultWorkspaceMode ?? null,
        allowedWorkspaceModes: normalizeWorkspaceModes(
          body.allowedWorkspaceModes,
        ),
      };
      validateWorkspacePolicy(workspacePolicy);
      validatePresetPolicy({
        preset: body.preset ?? DEFAULT_RUNTIME_PROFILE_PRESET,
        ...workspacePolicy,
        maxTurns: body.maxTurns ?? 0,
      });
      const definitionCid = await computeProfileDefinitionCid(body);
      try {
        const row = await fastify.runtimeProfileRepository.create({
          teamId,
          name: body.name,
          description: body.description ?? null,
          preset: body.preset ?? DEFAULT_RUNTIME_PROFILE_PRESET,
          provider: body.provider.toLowerCase(),
          model: body.model.toLowerCase(),
          thinkingLevel: body.thinkingLevel ?? null,
          temperature: body.temperature ?? null,
          topP: body.topP ?? null,
          topK: body.topK ?? null,
          maxOutputTokens: body.maxOutputTokens ?? null,
          runtimeKind: body.runtimeKind ?? 'gondolin_pi',
          sandbox: body.sandbox,
          sessionStorageMode: body.sessionStorageMode ?? 'local',
          workspaceStorageMode: body.workspaceStorageMode ?? 'local',
          defaultWorkspaceMode: workspacePolicy.defaultWorkspaceMode,
          allowedWorkspaceModes: workspacePolicy.allowedWorkspaceModes,
          sessionTtlSec: body.sessionTtlSec ?? 1800,
          workspaceTtlSec: body.workspaceTtlSec ?? 1800,
          leaseTtlSec: body.leaseTtlSec ?? 300,
          heartbeatIntervalMs: body.heartbeatIntervalMs ?? 60_000,
          maxBatchSize: body.maxBatchSize ?? 50,
          maxTurns: body.maxTurns ?? 0,
          maxBashTimeouts: body.maxBashTimeouts ?? 3,
          requiredEnv: normalizeList(body.requiredEnv),
          requiredTools: normalizeList(body.requiredTools),
          context: body.context ?? [],
          definitionCid,
          createdByAgentId: creator.kind === 'agent' ? creator.id : null,
          createdByHumanId: creator.kind === 'human' ? creator.id : null,
        });
        return await reply.status(201).send(serializeProfile(row));
      } catch (err) {
        if (err instanceof UniqueViolationError) {
          throw createConflictProblem(
            'A runtime profile with this name already exists in this team',
            {
              constraint: err.constraint,
              target: err.target,
            },
          );
        }
        throw err;
      }
    },
  );

  server.get(
    '/runtime-profiles/:profileId',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'getRuntimeProfile',
        tags: ['runtime-profiles'],
        description: 'Get one runtime profile.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: ProfileParamsSchema,
        response: {
          200: Type.Ref(RuntimeProfileSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const row = await fastify.runtimeProfileRepository.findById(
        request.params.profileId,
      );
      if (!row) throw createProblem('not-found');
      const { identityId, subjectNs } = authSubject(request);
      const canAccess = await fastify.permissionChecker.canAccessTeam(
        row.teamId,
        identityId,
        subjectNs,
      );
      if (!canAccess) throw createProblem('not-found');
      return serializeProfile(row);
    },
  );

  server.patch(
    '/runtime-profiles/:profileId',
    {
      preValidation: validateRuntimeProfileModelOptions,
      schema: {
        operationId: 'updateRuntimeProfile',
        tags: ['runtime-profiles'],
        description: 'Update one runtime profile.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: ProfileParamsSchema,
        body: Type.Ref(UpdateRuntimeProfileBodySchema.$id),
        response: {
          200: Type.Ref(RuntimeProfileSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const existing = await fastify.runtimeProfileRepository.findById(
        request.params.profileId,
      );
      if (!existing) throw createProblem('not-found');
      const { identityId, subjectNs } = authSubject(request);
      const canManage = await fastify.permissionChecker.canManageTeamRuntime(
        existing.teamId,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');
      const body = request.body as Static<
        typeof UpdateRuntimeProfileBodySchema
      >;
      const next: ProfileDefinitionInput = {
        name: body.name ?? existing.name,
        description:
          'description' in body
            ? (body.description ?? null)
            : existing.description,
        preset: body.preset ?? (existing.preset as RuntimeProfilePreset),
        provider: (body.provider ?? existing.provider).toLowerCase(),
        model: (body.model ?? existing.model).toLowerCase(),
        thinkingLevel:
          'thinkingLevel' in body
            ? (body.thinkingLevel ?? null)
            : ((existing.thinkingLevel as RuntimeProfileThinkingLevel | null) ??
              null),
        temperature:
          'temperature' in body
            ? (body.temperature ?? null)
            : (existing.temperature ?? null),
        topP: 'topP' in body ? (body.topP ?? null) : (existing.topP ?? null),
        topK: 'topK' in body ? (body.topK ?? null) : (existing.topK ?? null),
        maxOutputTokens:
          'maxOutputTokens' in body
            ? (body.maxOutputTokens ?? null)
            : (existing.maxOutputTokens ?? null),
        runtimeKind: body.runtimeKind ?? 'gondolin_pi',
        sandbox: body.sandbox ?? existing.sandbox,
        sessionStorageMode: body.sessionStorageMode ?? 'local',
        workspaceStorageMode: body.workspaceStorageMode ?? 'local',
        defaultWorkspaceMode:
          'defaultWorkspaceMode' in body
            ? (body.defaultWorkspaceMode ?? null)
            : ((existing.defaultWorkspaceMode as RuntimeProfileWorkspaceMode | null) ??
              null),
        allowedWorkspaceModes: normalizeWorkspaceModes(
          body.allowedWorkspaceModes ??
            (existing.allowedWorkspaceModes as RuntimeProfileWorkspaceMode[]),
        ),
        sessionTtlSec: body.sessionTtlSec ?? existing.sessionTtlSec,
        workspaceTtlSec: body.workspaceTtlSec ?? existing.workspaceTtlSec,
        leaseTtlSec: body.leaseTtlSec ?? existing.leaseTtlSec,
        heartbeatIntervalMs:
          body.heartbeatIntervalMs ?? existing.heartbeatIntervalMs,
        maxBatchSize: body.maxBatchSize ?? existing.maxBatchSize,
        maxTurns: body.maxTurns ?? existing.maxTurns,
        maxBashTimeouts: body.maxBashTimeouts ?? existing.maxBashTimeouts,
        requiredEnv: normalizeList(body.requiredEnv ?? existing.requiredEnv),
        requiredTools: normalizeList(
          body.requiredTools ?? existing.requiredTools,
        ),
        context: body.context ?? (existing.context as unknown[]),
      };
      validateWorkspacePolicy({
        defaultWorkspaceMode: next.defaultWorkspaceMode ?? null,
        allowedWorkspaceModes: next.allowedWorkspaceModes ?? [],
      });
      validatePresetPolicy({
        preset: next.preset ?? DEFAULT_RUNTIME_PROFILE_PRESET,
        defaultWorkspaceMode: next.defaultWorkspaceMode ?? null,
        allowedWorkspaceModes: next.allowedWorkspaceModes ?? [],
        maxTurns: next.maxTurns ?? 0,
      });
      const definitionCid = await computeProfileDefinitionCid(next);
      try {
        const row = await fastify.runtimeProfileRepository.update(existing.id, {
          ...next,
          definitionCid,
        });
        if (!row) throw createProblem('not-found');
        return serializeProfile(row);
      } catch (err) {
        if (err instanceof UniqueViolationError) {
          throw createConflictProblem(
            'A runtime profile with this name already exists in this team',
            {
              constraint: err.constraint,
              target: err.target,
            },
          );
        }
        throw err;
      }
    },
  );

  server.delete(
    '/runtime-profiles/:profileId',
    {
      schema: {
        operationId: 'deleteRuntimeProfile',
        tags: ['runtime-profiles'],
        description: 'Delete one runtime profile.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: ProfileParamsSchema,
        response: {
          204: { type: 'null' },
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const row = await fastify.runtimeProfileRepository.findById(
        request.params.profileId,
      );
      if (!row) throw createProblem('not-found');
      const { identityId, subjectNs } = authSubject(request);
      const canManage = await fastify.permissionChecker.canManageTeamRuntime(
        row.teamId,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');
      await fastify.runtimeProfileRepository.delete(row.id);
      return reply.status(204).send(null);
    },
  );
}
