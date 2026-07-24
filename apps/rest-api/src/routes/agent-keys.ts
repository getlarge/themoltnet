import { randomUUID } from 'node:crypto';

import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import {
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
} from '@moltnet/models';
import {
  type ApiKeysApi,
  type IssuedApiKey,
  KeyStatus,
  KeyVisibility,
  RevocationReason,
} from '@ory/client-fetch';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { createProblem, createValidationProblem } from '../problems/index.js';
import {
  AgentKeyListSchema,
  AgentKeyParamsSchema,
  AgentKeyStatusSchema,
  AgentKeyWithSecretSchema,
  CreateAgentKeyBodySchema,
  RevokeAgentKeyBodySchema,
} from '../schemas.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';

const DEFAULT_TTL_DAYS = 30;
const TALOS_PAGE_SIZE = 1_000;
const AGENT_KEY_SCOPES = [
  'diary:read',
  'diary:write',
  'crypto:sign',
  'agent:profile',
  'team:read',
] as const;

type AgentKeyStatus = 'active' | 'revoked' | 'expired';
type AgentKeyRevocationReason =
  | 'key_compromise'
  | 'affiliation_changed'
  | 'superseded'
  | 'privilege_withdrawn';

interface AgentKeyBinding {
  agentId: string;
  teamId: string;
}

interface AgentKeyRoutesOptions {
  talosApi?: Pick<
    ApiKeysApi,
    | 'adminGetIssuedApiKey'
    | 'adminIssueApiKey'
    | 'adminListIssuedApiKeys'
    | 'adminRevokeIssuedApiKey'
    | 'adminRotateIssuedApiKey'
  >;
}

function getTalosApi(options: AgentKeyRoutesOptions) {
  if (!options.talosApi) {
    throw createProblem(
      'service-unavailable',
      'Agent key management is not configured',
    );
  }
  return options.talosApi;
}

function asRecord(value: object | undefined): Record<string, unknown> | null {
  if (!value || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readBinding(key: IssuedApiKey): AgentKeyBinding | null {
  const metadata = asRecord(key.metadata);
  if (
    metadata?.subject_type !== 'agent' ||
    typeof metadata.team_id !== 'string' ||
    typeof key.actor_id !== 'string'
  ) {
    return null;
  }
  return { agentId: key.actor_id, teamId: metadata.team_id };
}

function toStatus(status: IssuedApiKey['status']): AgentKeyStatus {
  switch (status) {
    case KeyStatus.KeyStatusRevoked:
      return 'revoked';
    case KeyStatus.KeyStatusExpired:
      return 'expired';
    case KeyStatus.KeyStatusActive:
    case KeyStatus.KeyStatusUnspecified:
    case undefined:
      return 'active';
    default:
      throw createProblem('upstream-error', 'Talos returned an unknown status');
  }
}

function fromRevocationReason(
  reason: IssuedApiKey['revocation_reason'],
): AgentKeyRevocationReason | null {
  switch (reason) {
    case RevocationReason.RevocationReasonKeyCompromise:
      return 'key_compromise';
    case RevocationReason.RevocationReasonAffiliationChanged:
      return 'affiliation_changed';
    case RevocationReason.RevocationReasonSuperseded:
      return 'superseded';
    case RevocationReason.RevocationReasonPrivilegeWithdrawn:
      return 'privilege_withdrawn';
    default:
      return null;
  }
}

function toRevocationReason(
  reason: AgentKeyRevocationReason,
): RevocationReason {
  switch (reason) {
    case 'key_compromise':
      return RevocationReason.RevocationReasonKeyCompromise;
    case 'affiliation_changed':
      return RevocationReason.RevocationReasonAffiliationChanged;
    case 'superseded':
      return RevocationReason.RevocationReasonSuperseded;
    case 'privilege_withdrawn':
      return RevocationReason.RevocationReasonPrivilegeWithdrawn;
  }
}

function toAgentKey(key: IssuedApiKey) {
  const binding = readBinding(key);
  if (!binding || !key.key_id) {
    throw createProblem(
      'upstream-error',
      'Talos returned an incomplete agent key',
    );
  }

  return {
    id: key.key_id,
    agentId: binding.agentId,
    teamId: binding.teamId,
    name: key.name ?? key.key_id,
    status: toStatus(key.status),
    createdAt: key.create_time?.toISOString() ?? null,
    expiresAt: key.expire_time?.toISOString() ?? null,
    lastUsedAt: key.last_used_time?.toISOString() ?? null,
    updatedAt: key.update_time?.toISOString() ?? null,
    revocationReason: fromRevocationReason(key.revocation_reason),
    revocationDescription: key.revocation_description ?? null,
  };
}

function encodePageToken(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString('base64url');
}

function decodePageToken(token: string | undefined): number {
  if (!token) return 0;
  try {
    const decoded = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8'),
    ) as unknown;
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'offset' in decoded &&
      typeof decoded.offset === 'number' &&
      Number.isInteger(decoded.offset) &&
      decoded.offset >= 0
    ) {
      return decoded.offset;
    }
  } catch {
    // Normalized to a public validation error below.
  }
  throw createValidationProblem(
    [{ field: 'pageToken', message: 'Invalid page token' }],
    'Invalid agent key page token',
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'status' in error.response &&
    error.response.status === 404
  );
}

async function getTeamKey(
  api: ReturnType<typeof getTalosApi>,
  keyId: string,
  teamId: string,
): Promise<{ key: IssuedApiKey; binding: AgentKeyBinding }> {
  let key: IssuedApiKey;
  try {
    key = await api.adminGetIssuedApiKey({ keyId });
  } catch (error) {
    if (isNotFoundError(error)) throw createProblem('not-found');
    throw createProblem('upstream-error', 'Failed to read agent key');
  }
  const binding = readBinding(key);
  if (!binding || binding.teamId !== teamId) {
    throw createProblem('not-found');
  }
  return { key, binding };
}

function authSubject(request: FastifyRequest) {
  const auth = request.authContext;
  if (!auth) throw createProblem('unauthorized');
  return {
    identityId: auth.identityId,
    subjectType: auth.subjectType,
    subjectNs:
      auth.subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent,
  };
}

async function canManageAllTeamKeys(
  request: FastifyRequest,
  teamId: string,
): Promise<boolean> {
  const subject = authSubject(request);
  return request.server.permissionChecker.canManageTeamCredentials(
    teamId,
    subject.identityId,
    subject.subjectNs,
  );
}

async function assertCanManageAgentKey(
  request: FastifyRequest,
  teamId: string,
  agentId: string,
): Promise<void> {
  const subject = authSubject(request);
  if (subject.subjectType === 'agent' && subject.identityId === agentId) return;
  if (await canManageAllTeamKeys(request, teamId)) return;
  throw createProblem('forbidden');
}

async function assertCurrentAgentMember(
  request: FastifyRequest,
  teamId: string,
  agentId: string,
): Promise<void> {
  const members =
    await request.server.relationshipReader.listTeamMembers(teamId);
  const isAgentMember = members.some(
    (member) => member.subjectNs === 'Agent' && member.subjectId === agentId,
  );
  const agent = await request.server.agentRepository.findByIdentityId(agentId);
  if (!isAgentMember || !agent) {
    throw createProblem(
      'validation-failed',
      'Target agent is not a current member of this team',
    );
  }
}

async function listAllIssuedKeys(
  api: ReturnType<typeof getTalosApi>,
): Promise<IssuedApiKey[]> {
  const keys: IssuedApiKey[] = [];
  let pageToken: string | undefined;
  do {
    const result = await api.adminListIssuedApiKeys({
      pageSize: TALOS_PAGE_SIZE,
      pageToken,
    });
    keys.push(...(result.issued_api_keys ?? []));
    pageToken = result.next_page_token || undefined;
  } while (pageToken);
  return keys;
}

export async function agentKeyRoutes(
  fastify: FastifyInstance,
  options: AgentKeyRoutesOptions,
) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  server.post(
    '/agent-keys',
    {
      config: { auth: { talosCredentialScope: 'team' } },
      schema: {
        operationId: 'createAgentKey',
        tags: ['agent-keys'],
        description:
          'Issue a secret API key bound to one agent and the active team.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        body: CreateAgentKeyBodySchema,
        response: {
          201: Type.Ref(AgentKeyWithSecretSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const api = getTalosApi(options);
      const teamId = requireCurrentTeamId(request, 'agent keys');
      const { agentId, name, ttlDays = DEFAULT_TTL_DAYS } = request.body;

      await assertCanManageAgentKey(request, teamId, agentId);
      await assertCurrentAgentMember(request, teamId, agentId);

      let result: Awaited<ReturnType<typeof api.adminIssueApiKey>>;
      try {
        result = await api.adminIssueApiKey({
          issueApiKeyRequest: {
            actor_id: agentId,
            name: name.trim(),
            request_id: randomUUID(),
            ttl: `${ttlDays * 86_400}s`,
            visibility: KeyVisibility.KeyVisibilitySecret,
            scopes: [...AGENT_KEY_SCOPES],
            metadata: {
              schema_version: 1,
              subject_type: 'agent',
              team_id: teamId,
            },
          },
        });
      } catch {
        throw createProblem('upstream-error', 'Failed to issue agent key');
      }
      if (!result.issued_api_key || !result.secret) {
        throw createProblem(
          'upstream-error',
          'Talos did not return the issued agent key secret',
        );
      }

      request.log.info(
        {
          action: 'issue',
          keyId: result.issued_api_key.key_id,
          agentId,
          teamId,
          ttlDays,
        },
        'agent_key.lifecycle',
      );
      return reply.status(201).send({
        key: toAgentKey(result.issued_api_key),
        secret: result.secret,
      });
    },
  );

  server.get(
    '/agent-keys',
    {
      config: {
        auth: { talosCredentialScope: 'team' },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'listAgentKeys',
        tags: ['agent-keys'],
        description:
          'List agent API keys bound to the active team. Team credential managers may list every agent.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        querystring: Type.Object({
          agentId: Type.Optional(Type.String({ format: 'uuid' })),
          status: Type.Optional(AgentKeyStatusSchema),
          pageSize: Type.Optional(
            Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
          ),
          pageToken: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Ref(AgentKeyListSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const api = getTalosApi(options);
      const teamId = requireCurrentTeamId(request, 'agent keys');
      const subject = authSubject(request);
      const canManageAll = await canManageAllTeamKeys(request, teamId);
      if (!canManageAll && subject.subjectType !== 'agent') {
        throw createProblem('forbidden');
      }
      if (
        !canManageAll &&
        request.query.agentId &&
        request.query.agentId !== subject.identityId
      ) {
        throw createProblem('forbidden');
      }

      let issuedKeys: IssuedApiKey[];
      try {
        issuedKeys = await listAllIssuedKeys(api);
      } catch {
        throw createProblem('upstream-error', 'Failed to list agent keys');
      }

      const agentFilter = canManageAll
        ? request.query.agentId
        : subject.identityId;
      const matching = issuedKeys
        .filter((key) => {
          const binding = readBinding(key);
          return (
            binding?.teamId === teamId &&
            (!agentFilter || binding.agentId === agentFilter)
          );
        })
        .map(toAgentKey)
        .filter(
          (key) => !request.query.status || key.status === request.query.status,
        )
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

      const offset = decodePageToken(request.query.pageToken);
      const pageSize = request.query.pageSize ?? 20;
      const items = matching.slice(offset, offset + pageSize);
      const nextOffset = offset + items.length;

      request.log.debug(
        {
          action: 'list',
          teamId,
          actorId: subject.identityId,
          scannedCount: issuedKeys.length,
          matchedCount: matching.length,
        },
        'agent_key.lifecycle',
      );
      return {
        items,
        nextPageToken:
          nextOffset < matching.length ? encodePageToken(nextOffset) : null,
      };
    },
  );

  server.post(
    '/agent-keys/:keyId/rotate',
    {
      config: { auth: { talosCredentialScope: 'team' } },
      schema: {
        operationId: 'rotateAgentKey',
        tags: ['agent-keys'],
        description:
          'Rotate an agent API key immediately. The previous secret is revoked and expiry is unchanged.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: AgentKeyParamsSchema,
        response: {
          200: Type.Ref(AgentKeyWithSecretSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const api = getTalosApi(options);
      const teamId = requireCurrentTeamId(request, 'agent keys');
      const { key, binding } = await getTeamKey(
        api,
        request.params.keyId,
        teamId,
      );
      await assertCanManageAgentKey(request, teamId, binding.agentId);
      await assertCurrentAgentMember(request, teamId, binding.agentId);

      let result: Awaited<ReturnType<typeof api.adminRotateIssuedApiKey>>;
      try {
        result = await api.adminRotateIssuedApiKey({
          keyId: request.params.keyId,
          adminRotateIssuedApiKeyBody: {
            metadata: {
              schema_version: 1,
              subject_type: 'agent',
              team_id: teamId,
            },
            scopes: [...AGENT_KEY_SCOPES],
            visibility: KeyVisibility.KeyVisibilitySecret,
          },
        });
      } catch (error) {
        if (isNotFoundError(error)) throw createProblem('not-found');
        throw createProblem('upstream-error', 'Failed to rotate agent key');
      }
      if (!result.issued_api_key || !result.secret) {
        throw createProblem(
          'upstream-error',
          'Talos did not return the rotated agent key secret',
        );
      }

      request.log.info(
        {
          action: 'rotate',
          oldKeyId: key.key_id,
          keyId: result.issued_api_key.key_id,
          agentId: binding.agentId,
          teamId,
        },
        'agent_key.lifecycle',
      );
      return {
        key: toAgentKey(result.issued_api_key),
        secret: result.secret,
      };
    },
  );

  server.post(
    '/agent-keys/:keyId/revoke',
    {
      config: { auth: { talosCredentialScope: 'team' } },
      schema: {
        operationId: 'revokeAgentKey',
        tags: ['agent-keys'],
        description: 'Permanently revoke an agent API key.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: AgentKeyParamsSchema,
        body: RevokeAgentKeyBodySchema,
        response: {
          204: Type.Null(),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
          503: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const api = getTalosApi(options);
      const teamId = requireCurrentTeamId(request, 'agent keys');
      const { binding } = await getTeamKey(api, request.params.keyId, teamId);
      await assertCanManageAgentKey(request, teamId, binding.agentId);

      const { reason, description } = request.body;
      if (description && reason !== 'privilege_withdrawn') {
        throw createValidationProblem(
          [
            {
              field: 'description',
              message:
                'description is only allowed for privilege_withdrawn revocations',
            },
          ],
          'Invalid revocation description',
        );
      }

      try {
        await api.adminRevokeIssuedApiKey({
          keyId: request.params.keyId,
          adminRevokeIssuedApiKeyBody: {
            reason: toRevocationReason(reason),
            ...(description ? { description } : {}),
          },
        });
      } catch (error) {
        if (isNotFoundError(error)) throw createProblem('not-found');
        throw createProblem('upstream-error', 'Failed to revoke agent key');
      }

      request.log.info(
        {
          action: 'revoke',
          keyId: request.params.keyId,
          agentId: binding.agentId,
          teamId,
          reason,
        },
        'agent_key.lifecycle',
      );
      return reply.status(204).send(null);
    },
  );
}
