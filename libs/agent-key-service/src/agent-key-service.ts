import { createHash } from 'node:crypto';

import {
  AGENT_CREDENTIAL_SCOPES,
  AGENT_OAUTH_SCOPES,
  KetoNamespace,
  type PermissionChecker,
  type RelationshipReader,
} from '@moltnet/auth';
import type { AgentRepository } from '@moltnet/database';
import {
  type ApiKeysApi,
  type IssuedApiKey,
  KeyStatus,
  KeyVisibility,
  RevocationReason,
} from '@ory/client-fetch';

import { decodeOpaqueCursor, encodeOpaqueCursor } from './opaque-cursor.js';
import { createProblem, createValidationProblem } from './problems.js';

const DEFAULT_TTL_DAYS = 30;
const MAX_TALOS_LIST_PAGES_PER_REQUEST = 5;

export type AgentKeyStatus = 'active' | 'revoked' | 'expired';
export type AgentKeyRevocationReason =
  | 'key_compromise'
  | 'affiliation_changed'
  | 'superseded'
  | 'privilege_withdrawn';

export interface AgentKey {
  id: string;
  agentId: string;
  teamId: string;
  name: string;
  scopes: string[];
  status: AgentKeyStatus;
  createdAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  updatedAt: string | null;
  revocationReason: AgentKeyRevocationReason | null;
  revocationDescription: string | null;
}

export interface AgentKeyWithSecret {
  key: AgentKey;
  secret: string;
}

export interface AgentKeySubject {
  /** Bound API key used for this request, when available. */
  credentialKeyId?: string;
  identityId: string;
  scopes: string[];
  subjectNs: KetoNamespace;
  subjectType: 'agent' | 'human';
}

interface AgentKeyBinding {
  agentId: string;
  teamId: string;
}

interface Logger {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

type TalosApi = Pick<
  ApiKeysApi,
  | 'adminGetIssuedApiKey'
  | 'adminIssueApiKey'
  | 'adminListIssuedApiKeys'
  | 'adminRevokeIssuedApiKey'
  | 'adminRotateIssuedApiKey'
>;

export interface AgentKeyServiceDeps {
  agentRepository: AgentRepository;
  permissionChecker: PermissionChecker;
  relationshipReader: RelationshipReader;
  talosApi?: TalosApi;
}

export interface IssueAgentKeyInput {
  agentId: string;
  idempotencyKey: string;
  logger: Logger;
  name: string;
  scopes?: string[];
  signal?: AbortSignal;
  subject: AgentKeySubject;
  teamId: string;
  ttlDays?: number;
}

export interface ListAgentKeysInput {
  agentId?: string;
  cursor?: string;
  limit?: number;
  logger: Logger;
  signal?: AbortSignal;
  status?: AgentKeyStatus;
  subject: AgentKeySubject;
  teamId: string;
}

export interface RotateAgentKeyInput {
  keyId: string;
  logger: Logger;
  signal?: AbortSignal;
  subject: AgentKeySubject;
  teamId: string;
}

export interface RevokeAgentKeyInput {
  description?: string;
  keyId: string;
  logger: Logger;
  reason: AgentKeyRevocationReason;
  signal?: AbortSignal;
  subject: AgentKeySubject;
  teamId: string;
}

function getTalosApi(deps: AgentKeyServiceDeps): TalosApi {
  if (!deps.talosApi) {
    throw createProblem(
      'service-unavailable',
      'Agent key management is not configured',
    );
  }
  return deps.talosApi;
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

function effectiveStatus(key: IssuedApiKey): AgentKeyStatus {
  const status = toStatus(key.status);
  if (
    status === 'active' &&
    key.expire_time &&
    key.expire_time.getTime() <= Date.now()
  ) {
    return 'expired';
  }
  return status;
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

function toAgentKey(key: IssuedApiKey): AgentKey {
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
    scopes: key.scopes ?? [],
    status: effectiveStatus(key),
    createdAt: key.create_time?.toISOString() ?? null,
    expiresAt: key.expire_time?.toISOString() ?? null,
    lastUsedAt: key.last_used_time?.toISOString() ?? null,
    updatedAt: key.update_time?.toISOString() ?? null,
    revocationReason: fromRevocationReason(key.revocation_reason),
    revocationDescription: key.revocation_description ?? null,
  };
}

interface AgentKeyCursor {
  actorId: string | null;
  pageToken: string;
  status: AgentKeyStatus | null;
  teamId: string;
  version: 1;
}

function isAgentKeyStatus(value: unknown): value is AgentKeyStatus {
  return value === 'active' || value === 'revoked' || value === 'expired';
}

function isAgentKeyCursor(value: unknown): value is AgentKeyCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    value.version === 1 &&
    'pageToken' in value &&
    typeof value.pageToken === 'string' &&
    value.pageToken.length > 0 &&
    'teamId' in value &&
    typeof value.teamId === 'string' &&
    'actorId' in value &&
    (value.actorId === null || typeof value.actorId === 'string') &&
    'status' in value &&
    (value.status === null || isAgentKeyStatus(value.status))
  );
}

function decodeCursor(
  cursor: string | undefined,
  expected: Omit<AgentKeyCursor, 'pageToken' | 'version'>,
): string | undefined {
  if (!cursor) return undefined;
  const decoded = decodeOpaqueCursor(cursor, isAgentKeyCursor);
  if (
    decoded &&
    decoded.teamId === expected.teamId &&
    decoded.actorId === expected.actorId &&
    decoded.status === expected.status
  ) {
    return decoded.pageToken;
  }
  throw createValidationProblem(
    [{ field: 'cursor', message: 'Invalid cursor for this query' }],
    'Invalid agent key cursor',
  );
}

function encodeCursor(
  pageToken: string,
  query: Omit<AgentKeyCursor, 'pageToken' | 'version'>,
): string {
  return encodeOpaqueCursor({ ...query, pageToken, version: 1 });
}

function talosRequestId(input: IssueAgentKeyInput): string {
  const hex = createHash('sha256')
    .update('moltnet:agent-key:v1\0')
    .update(input.teamId)
    .update('\0')
    .update(input.agentId)
    .update('\0')
    .update(input.idempotencyKey)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function assertDelegableScopes(
  requested: readonly string[],
  subject: AgentKeySubject,
): void {
  const maximum = new Set<string>(AGENT_OAUTH_SCOPES);
  const invalid = requested.find((scope) => !maximum.has(scope));
  if (invalid) {
    throw createValidationProblem(
      [
        {
          field: 'scopes',
          message: `Unknown or non-grantable scope: ${invalid}`,
        },
      ],
      'Invalid agent key scopes',
    );
  }

  const held = new Set(subject.scopes);
  const escalation = requested.find((scope) => !held.has(scope));
  if (escalation) {
    throw createProblem(
      'forbidden',
      `Requesting credential cannot delegate scope: ${escalation}`,
    );
  }
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

function talosInit(signal: AbortSignal | undefined): RequestInit | undefined {
  return signal ? { signal } : undefined;
}

function talosFailureKind(
  error: unknown,
  signal: AbortSignal | undefined,
): 'cancelled' | 'timeout' | 'upstream' {
  if (signal?.aborted) return 'cancelled';
  if (typeof error !== 'object' || error === null) return 'upstream';
  const candidate = error as {
    name?: unknown;
    cause?: { code?: unknown };
  };
  if (
    candidate.name === 'TimeoutError' ||
    candidate.cause?.code === 'ETIMEDOUT'
  ) {
    return 'timeout';
  }
  if (candidate.name === 'AbortError') return 'cancelled';
  return 'upstream';
}

async function getTeamKey(
  api: TalosApi,
  keyId: string,
  teamId: string,
  logger: Logger,
  action: 'rotate' | 'revoke',
  signal: AbortSignal | undefined,
): Promise<{ key: IssuedApiKey; binding: AgentKeyBinding }> {
  let key: IssuedApiKey;
  try {
    key = await api.adminGetIssuedApiKey({ keyId }, talosInit(signal));
  } catch (error) {
    if (isNotFoundError(error)) throw createProblem('not-found');
    logger.warn(
      {
        err: error,
        action: `${action}:read`,
        failureKind: talosFailureKind(error, signal),
        keyId,
        teamId,
      },
      'agent_key.upstream_error',
    );
    throw createProblem('upstream-error', 'Failed to read agent key');
  }
  const binding = readBinding(key);
  if (!binding || binding.teamId !== teamId) {
    throw createProblem('not-found');
  }
  return { key, binding };
}

async function canManageAllTeamKeys(
  deps: AgentKeyServiceDeps,
  subject: AgentKeySubject,
  teamId: string,
): Promise<boolean> {
  return deps.permissionChecker.canManageTeamCredentials(
    teamId,
    subject.identityId,
    subject.subjectNs,
  );
}

async function assertCanManageAgentKey(
  deps: AgentKeyServiceDeps,
  subject: AgentKeySubject,
  teamId: string,
  agentId: string,
): Promise<void> {
  if (subject.subjectType === 'agent' && subject.identityId === agentId) return;
  if (await canManageAllTeamKeys(deps, subject, teamId)) return;
  throw createProblem('forbidden');
}

async function assertCanManageExistingAgentKey(
  deps: AgentKeyServiceDeps,
  subject: AgentKeySubject,
  teamId: string,
  agentId: string,
): Promise<void> {
  if (subject.subjectType === 'agent' && subject.identityId === agentId) return;
  if (await canManageAllTeamKeys(deps, subject, teamId)) return;
  throw createProblem('not-found');
}

async function assertCurrentAgentMember(
  deps: AgentKeyServiceDeps,
  teamId: string,
  agentId: string,
): Promise<void> {
  const isAgentMember = await deps.relationshipReader.isTeamMember(
    teamId,
    agentId,
    KetoNamespace.Agent,
  );
  const agent = await deps.agentRepository.findByIdentityId(agentId);
  if (!isAgentMember || !agent) {
    throw createValidationProblem(
      [
        {
          field: 'agentId',
          message: 'Target agent is not a current member of this team',
        },
      ],
      'Target agent is not a current member of this team',
    );
  }
}

function actorFilter(actorId: string | undefined): string | undefined {
  if (!actorId) return undefined;
  return `actor_id="${actorId.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

interface ResolvedListQuery {
  agentFilter: string | undefined;
  cursorQuery: Omit<AgentKeyCursor, 'pageToken' | 'version'>;
  limit: number;
  pageToken: string | undefined;
}

async function resolveListQuery(
  deps: AgentKeyServiceDeps,
  input: ListAgentKeysInput,
): Promise<ResolvedListQuery> {
  const canManageAll = await canManageAllTeamKeys(
    deps,
    input.subject,
    input.teamId,
  );
  if (!canManageAll && input.subject.subjectType !== 'agent') {
    throw createProblem('forbidden');
  }
  if (
    !canManageAll &&
    input.agentId &&
    input.agentId !== input.subject.identityId
  ) {
    throw createProblem('forbidden');
  }

  const agentFilter = canManageAll ? input.agentId : input.subject.identityId;
  const cursorQuery = {
    actorId: agentFilter ?? null,
    status: input.status ?? null,
    teamId: input.teamId,
  };
  return {
    agentFilter,
    cursorQuery,
    limit: input.limit ?? 20,
    pageToken: decodeCursor(input.cursor, cursorQuery),
  };
}

async function scanAgentKeyPages(
  api: TalosApi,
  input: ListAgentKeysInput,
  query: ResolvedListQuery,
): Promise<{ items: AgentKey[]; nextCursor: string | null }> {
  let pageToken = query.pageToken;
  let nextPageToken: string | undefined;
  let scannedCount = 0;
  let talosCalls = 0;
  const seenTokens = new Set<string>();
  const items: AgentKey[] = [];

  do {
    if (pageToken) {
      if (seenTokens.has(pageToken)) {
        input.logger.warn(
          {
            action: 'list',
            teamId: input.teamId,
            pageTokenRepeated: true,
          },
          'agent_key.upstream_error',
        );
        throw createProblem(
          'upstream-error',
          'Talos returned a repeated page token',
        );
      }
      seenTokens.add(pageToken);
    }

    let result: Awaited<ReturnType<typeof api.adminListIssuedApiKeys>>;
    try {
      result = await api.adminListIssuedApiKeys(
        {
          filter: actorFilter(query.agentFilter),
          pageSize: query.limit - items.length,
          pageToken,
        },
        talosInit(input.signal),
      );
    } catch (error) {
      input.logger.warn(
        {
          err: error,
          action: 'list',
          actorId: query.agentFilter,
          failureKind: talosFailureKind(error, input.signal),
          teamId: input.teamId,
        },
        'agent_key.upstream_error',
      );
      throw createProblem('upstream-error', 'Failed to list agent keys');
    }

    talosCalls += 1;
    const issuedKeys = result.issued_api_keys ?? [];
    scannedCount += issuedKeys.length;
    for (const issuedKey of issuedKeys) {
      const binding = readBinding(issuedKey);
      if (
        binding?.teamId !== input.teamId ||
        (query.agentFilter && binding.agentId !== query.agentFilter)
      ) {
        continue;
      }
      try {
        const key = toAgentKey(issuedKey);
        if (!input.status || key.status === input.status) items.push(key);
      } catch (error) {
        input.logger.warn(
          {
            err: error,
            action: 'list:map',
            keyId: issuedKey.key_id,
            actorId: issuedKey.actor_id,
            teamId: input.teamId,
          },
          'agent_key.malformed_upstream_row',
        );
      }
    }
    nextPageToken = result.next_page_token || undefined;
    pageToken = nextPageToken;
  } while (
    items.length < query.limit &&
    nextPageToken &&
    talosCalls < MAX_TALOS_LIST_PAGES_PER_REQUEST
  );

  const scanBudgetExhausted = Boolean(
    nextPageToken &&
    items.length < query.limit &&
    talosCalls >= MAX_TALOS_LIST_PAGES_PER_REQUEST,
  );
  input.logger.debug(
    {
      action: 'list',
      teamId: input.teamId,
      actorId: input.subject.identityId,
      scannedCount,
      matchedCount: items.length,
      talosCalls,
      actorFilterApplied: Boolean(query.agentFilter),
      scanBudgetExhausted,
    },
    'agent_key.lifecycle',
  );
  return {
    items,
    nextCursor: nextPageToken
      ? encodeCursor(nextPageToken, query.cursorQuery)
      : null,
  };
}

export function createAgentKeyService(deps: AgentKeyServiceDeps) {
  return {
    async issue(input: IssueAgentKeyInput): Promise<AgentKeyWithSecret> {
      const api = getTalosApi(deps);
      const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS;
      const scopes = input.scopes ?? [...AGENT_CREDENTIAL_SCOPES];
      assertDelegableScopes(scopes, input.subject);
      await assertCanManageAgentKey(
        deps,
        input.subject,
        input.teamId,
        input.agentId,
      );
      await assertCurrentAgentMember(deps, input.teamId, input.agentId);
      const name = input.name.trim();
      if (!name) {
        throw createValidationProblem(
          [
            {
              field: 'name',
              message: 'Name must contain a non-space character',
            },
          ],
          'Invalid agent key name',
        );
      }

      let result: Awaited<ReturnType<typeof api.adminIssueApiKey>>;
      try {
        result = await api.adminIssueApiKey(
          {
            issueApiKeyRequest: {
              actor_id: input.agentId,
              name,
              request_id: talosRequestId(input),
              ttl: `${ttlDays * 86_400}s`,
              visibility: KeyVisibility.KeyVisibilitySecret,
              scopes,
              metadata: {
                schema_version: 1,
                subject_type: 'agent',
                team_id: input.teamId,
              },
            },
          },
          talosInit(input.signal),
        );
      } catch (error) {
        input.logger.warn(
          {
            err: error,
            action: 'issue',
            agentId: input.agentId,
            failureKind: talosFailureKind(error, input.signal),
            teamId: input.teamId,
          },
          'agent_key.upstream_error',
        );
        throw createProblem('upstream-error', 'Failed to issue agent key');
      }
      if (result.issued_api_key && !result.secret) {
        input.logger.warn(
          {
            action: 'issue:replay',
            keyId: result.issued_api_key.key_id,
            agentId: input.agentId,
            teamId: input.teamId,
          },
          'agent_key.idempotency_replay',
        );
        throw createProblem(
          'conflict',
          'This idempotency key already issued an agent key. The original secret cannot be recovered; rotate or revoke the listed key.',
        );
      }
      if (!result.issued_api_key || !result.secret) {
        throw createProblem(
          'upstream-error',
          'Talos did not return the issued agent key secret',
        );
      }

      let key: AgentKey;
      try {
        key = toAgentKey(result.issued_api_key);
      } catch (error) {
        input.logger.warn(
          {
            err: error,
            action: 'issue:validate',
            keyId: result.issued_api_key.key_id,
            agentId: input.agentId,
            teamId: input.teamId,
          },
          'agent_key.malformed_upstream_row',
        );
        throw createProblem(
          'upstream-error',
          'Talos returned an invalid issued agent key',
        );
      }
      input.logger.info(
        {
          action: 'issue',
          keyId: result.issued_api_key.key_id,
          agentId: input.agentId,
          teamId: input.teamId,
          ttlDays,
        },
        'agent_key.lifecycle',
      );
      return {
        key,
        secret: result.secret,
      };
    },

    async list(input: ListAgentKeysInput): Promise<{
      items: AgentKey[];
      nextCursor: string | null;
    }> {
      const api = getTalosApi(deps);
      const query = await resolveListQuery(deps, input);
      return scanAgentKeyPages(api, input, query);
    },

    async rotate(input: RotateAgentKeyInput): Promise<AgentKeyWithSecret> {
      const api = getTalosApi(deps);
      const { key, binding } = await getTeamKey(
        api,
        input.keyId,
        input.teamId,
        input.logger,
        'rotate',
        input.signal,
      );
      await assertCanManageExistingAgentKey(
        deps,
        input.subject,
        input.teamId,
        binding.agentId,
      );
      if (input.subject.credentialKeyId === input.keyId) {
        throw createProblem(
          'conflict',
          'The credential being rotated cannot authorize its own rotation. Use OAuth, a different active key, or a team credential manager so a lost response remains recoverable.',
        );
      }
      await assertCurrentAgentMember(deps, input.teamId, binding.agentId);
      const scopes = key.scopes ?? [];
      assertDelegableScopes(scopes, input.subject);

      let result: Awaited<ReturnType<typeof api.adminRotateIssuedApiKey>>;
      try {
        result = await api.adminRotateIssuedApiKey(
          {
            keyId: input.keyId,
            adminRotateIssuedApiKeyBody: {
              metadata: {
                schema_version: 1,
                subject_type: 'agent',
                team_id: input.teamId,
              },
              scopes,
              visibility: KeyVisibility.KeyVisibilitySecret,
            },
          },
          talosInit(input.signal),
        );
      } catch (error) {
        if (isNotFoundError(error)) throw createProblem('not-found');
        input.logger.warn(
          {
            err: error,
            action: 'rotate',
            failureKind: talosFailureKind(error, input.signal),
            keyId: input.keyId,
            teamId: input.teamId,
          },
          'agent_key.upstream_error',
        );
        throw createProblem('upstream-error', 'Failed to rotate agent key');
      }
      if (!result.issued_api_key || !result.secret) {
        throw createProblem(
          'upstream-error',
          'Talos did not return the rotated agent key secret',
        );
      }

      let rotatedKey: AgentKey;
      try {
        rotatedKey = toAgentKey(result.issued_api_key);
        if (
          rotatedKey.agentId !== binding.agentId ||
          rotatedKey.teamId !== input.teamId
        ) {
          throw new Error('Rotated key binding changed');
        }
      } catch (error) {
        input.logger.warn(
          {
            err: error,
            action: 'rotate:validate',
            keyId: result.issued_api_key.key_id,
            oldKeyId: input.keyId,
            teamId: input.teamId,
          },
          'agent_key.malformed_upstream_row',
        );
        throw createProblem(
          'upstream-error',
          'Talos returned an invalid rotated agent key',
        );
      }
      input.logger.info(
        {
          action: 'rotate',
          oldKeyId: key.key_id,
          keyId: result.issued_api_key.key_id,
          agentId: binding.agentId,
          teamId: input.teamId,
        },
        'agent_key.lifecycle',
      );
      return {
        key: rotatedKey,
        secret: result.secret,
      };
    },

    async revoke(input: RevokeAgentKeyInput): Promise<void> {
      const api = getTalosApi(deps);
      const { binding } = await getTeamKey(
        api,
        input.keyId,
        input.teamId,
        input.logger,
        'revoke',
        input.signal,
      );
      await assertCanManageExistingAgentKey(
        deps,
        input.subject,
        input.teamId,
        binding.agentId,
      );

      if (input.description && input.reason !== 'privilege_withdrawn') {
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
        await api.adminRevokeIssuedApiKey(
          {
            keyId: input.keyId,
            adminRevokeIssuedApiKeyBody: {
              reason: toRevocationReason(input.reason),
              ...(input.description ? { description: input.description } : {}),
            },
          },
          talosInit(input.signal),
        );
      } catch (error) {
        if (isNotFoundError(error)) throw createProblem('not-found');
        input.logger.warn(
          {
            err: error,
            action: 'revoke',
            failureKind: talosFailureKind(error, input.signal),
            keyId: input.keyId,
            teamId: input.teamId,
          },
          'agent_key.upstream_error',
        );
        throw createProblem('upstream-error', 'Failed to revoke agent key');
      }

      input.logger.info(
        {
          action: 'revoke',
          keyId: input.keyId,
          agentId: binding.agentId,
          teamId: input.teamId,
          reason: input.reason,
        },
        'agent_key.lifecycle',
      );
    },
  };
}
