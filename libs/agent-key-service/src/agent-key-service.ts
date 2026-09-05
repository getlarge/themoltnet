import { createHash } from 'node:crypto';

import {
  AGENT_CREDENTIAL_SCOPES,
  AGENT_OAUTH_SCOPES,
  agentKeyMetadata,
  credentialScopeSetsEqual,
  KetoNamespace,
  type PermissionChecker,
  readAgentKeyMetadataBinding,
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
const DEFAULT_LIST_LIMIT = 20;
const INVALID_KEY_CLEANUP_TIMEOUT_MS = 2_000;
const MAX_TALOS_LIST_PAGES_PER_REQUEST = 5;
const SECONDS_PER_DAY = 86_400;

export type AgentKeyStatus = 'active' | 'revoked' | 'expired';
export type AgentKeyRevocationReason =
  | 'key_compromise'
  | 'affiliation_changed'
  | 'superseded'
  | 'privilege_withdrawn';

interface AgentKeyBase {
  id: string;
  agentId: string;
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

export type AgentKey = AgentKeyBase &
  ({ bindingScope: 'team'; teamId: string } | { bindingScope: 'identity' });

export interface AgentKeyWithSecret {
  key: AgentKey;
  secret: string;
}

export interface AgentKeySubject {
  /** Bound API key used for this request, when available. */
  credentialKeyId?: string;
  /** Binding of the Talos credential authorizing this request; absent for OAuth. */
  credentialBindingScope?: 'identity' | 'team';
  /**
   * Internal agents.id, not the Kratos identity. Named for what it carries:
   * both are uuid, so the field name is the only thing telling a reader which
   * of the two this is.
   */
  agentId: string;
  scopes: string[];
  subjectNs: KetoNamespace;
  subjectType: 'agent' | 'human';
}

export type AgentKeyOperationBinding =
  | { bindingScope?: 'team'; teamId: string }
  | { bindingScope: 'identity'; teamId?: never };

type ResolvedAgentKeyBinding =
  | { bindingScope: 'team'; teamId: string }
  | { bindingScope: 'identity' };

type StoredAgentKeyBinding = ResolvedAgentKeyBinding & { agentId: string };

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

export type IssueAgentKeyInput = AgentKeyOperationBinding & {
  agentId: string;
  idempotencyKey: string;
  logger: Logger;
  name: string;
  /**
   * Registration-only recovery path. Talos cannot replay the original secret,
   * so rotate the idempotently-created key and return the replacement when a
   * durable registration step retries after losing the first response.
   */
  recoverReplayByRotation?: boolean;
  scopes?: string[];
  signal?: AbortSignal;
  subject: AgentKeySubject;
  ttlDays?: number;
};

export type ListAgentKeysInput = AgentKeyOperationBinding & {
  agentId?: string;
  cursor?: string;
  limit?: number;
  logger: Logger;
  signal?: AbortSignal;
  status?: AgentKeyStatus;
  subject: AgentKeySubject;
};

export type RotateAgentKeyInput = AgentKeyOperationBinding & {
  keyId: string;
  logger: Logger;
  signal?: AbortSignal;
  subject: AgentKeySubject;
};

export type RevokeAgentKeyInput = AgentKeyOperationBinding & {
  description?: string;
  keyId: string;
  logger: Logger;
  reason: AgentKeyRevocationReason;
  signal?: AbortSignal;
  subject: AgentKeySubject;
};

function getTalosApi(deps: AgentKeyServiceDeps): TalosApi {
  if (!deps.talosApi) {
    throw createProblem(
      'service-unavailable',
      'Agent key management is not configured',
    );
  }
  return deps.talosApi;
}

function resolveBinding(
  input: AgentKeyOperationBinding,
): ResolvedAgentKeyBinding {
  return input.bindingScope === 'identity'
    ? { bindingScope: 'identity' }
    : { bindingScope: 'team', teamId: input.teamId };
}

function bindingLogFields(
  binding: ResolvedAgentKeyBinding,
): Record<string, unknown> {
  return binding.bindingScope === 'team'
    ? { bindingScope: 'team', teamId: binding.teamId }
    : { bindingScope: 'identity' };
}

function readBinding(key: IssuedApiKey): StoredAgentKeyBinding | null {
  const binding = readAgentKeyMetadataBinding(key.metadata);
  if (!binding || typeof key.actor_id !== 'string') return null;
  return { agentId: key.actor_id, ...binding };
}

function bindingsEqual(
  left: ResolvedAgentKeyBinding,
  right: ResolvedAgentKeyBinding,
): boolean {
  return (
    left.bindingScope === right.bindingScope &&
    (left.bindingScope === 'identity' ||
      (right.bindingScope === 'team' && left.teamId === right.teamId))
  );
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

  const base: AgentKeyBase = {
    id: key.key_id,
    agentId: binding.agentId,
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
  return binding.bindingScope === 'team'
    ? { ...base, bindingScope: 'team', teamId: binding.teamId }
    : { ...base, bindingScope: 'identity' };
}

interface AgentKeyCursor {
  actorId: string | null;
  bindingScope: 'identity' | 'team';
  pageToken: string;
  status: AgentKeyStatus | null;
  teamId: string | null;
  version: 2;
}

function isAgentKeyStatus(value: unknown): value is AgentKeyStatus {
  return value === 'active' || value === 'revoked' || value === 'expired';
}

function isAgentKeyCursor(value: unknown): value is AgentKeyCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    value.version === 2 &&
    'pageToken' in value &&
    typeof value.pageToken === 'string' &&
    value.pageToken.length > 0 &&
    'bindingScope' in value &&
    (value.bindingScope === 'identity' || value.bindingScope === 'team') &&
    'teamId' in value &&
    (value.teamId === null || typeof value.teamId === 'string') &&
    ((value.bindingScope === 'identity' && value.teamId === null) ||
      (value.bindingScope === 'team' && typeof value.teamId === 'string')) &&
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
    decoded.bindingScope === expected.bindingScope &&
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
  return encodeOpaqueCursor({ ...query, pageToken, version: 2 });
}

function talosRequestId(
  input: IssueAgentKeyInput,
  binding: ResolvedAgentKeyBinding,
): string {
  const hash = createHash('sha256');
  if (binding.bindingScope === 'team') {
    // Preserve the v1 request-id transcript so an in-flight team-scoped retry
    // remains idempotent across this deployment.
    hash.update('moltnet:agent-key:v1\0').update(binding.teamId);
  } else {
    hash.update('moltnet:agent-key:v2\0identity');
  }
  const hex = hash
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

async function revokeInvalidIssuedKey(
  api: TalosApi,
  key: IssuedApiKey,
  expectedBinding: StoredAgentKeyBinding,
  logger: Logger,
  action: 'issue' | 'rotate',
): Promise<void> {
  if (!key.key_id) return;
  const binding = readBinding(key);
  if (
    binding?.agentId !== expectedBinding.agentId ||
    !bindingsEqual(binding, expectedBinding)
  ) {
    logger.warn(
      {
        action: `${action}:cleanup`,
        keyId: key.key_id,
        expectedAgentId: expectedBinding.agentId,
        bindingScope: expectedBinding.bindingScope,
        ...(expectedBinding.bindingScope === 'team'
          ? { expectedTeamId: expectedBinding.teamId }
          : {}),
      },
      'agent_key.cleanup_skipped_untrusted_binding',
    );
    return;
  }

  const cleanupSignal = AbortSignal.timeout(INVALID_KEY_CLEANUP_TIMEOUT_MS);
  try {
    await api.adminRevokeIssuedApiKey(
      {
        keyId: key.key_id,
        adminRevokeIssuedApiKeyBody: {
          reason: RevocationReason.RevocationReasonPrivilegeWithdrawn,
          description: `MoltNet rejected invalid Talos ${action} response`,
        },
      },
      talosInit(cleanupSignal),
    );
  } catch (error) {
    logger.warn(
      {
        err: error,
        action: `${action}:cleanup`,
        failureKind: talosFailureKind(error, cleanupSignal),
        keyId: key.key_id,
        timeoutMs: INVALID_KEY_CLEANUP_TIMEOUT_MS,
      },
      'agent_key.cleanup_failed',
    );
  }
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

async function getBoundKey(
  api: TalosApi,
  keyId: string,
  expectedBinding: ResolvedAgentKeyBinding,
  logger: Logger,
  action: 'rotate' | 'revoke',
  signal: AbortSignal | undefined,
): Promise<{ key: IssuedApiKey; binding: StoredAgentKeyBinding }> {
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
        ...bindingLogFields(expectedBinding),
      },
      'agent_key.upstream_error',
    );
    throw createProblem('upstream-error', 'Failed to read agent key');
  }
  const binding = readBinding(key);
  if (!binding || !bindingsEqual(binding, expectedBinding)) {
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
    subject.agentId,
    subject.subjectNs,
  );
}

async function assertCanManageAgentKey(
  deps: AgentKeyServiceDeps,
  subject: AgentKeySubject,
  binding: ResolvedAgentKeyBinding,
  agentId: string,
): Promise<void> {
  if (binding.bindingScope === 'identity') {
    if (
      subject.subjectType === 'agent' &&
      subject.agentId === agentId &&
      subject.credentialBindingScope !== 'team'
    ) {
      return;
    }
    throw createProblem('forbidden');
  }
  if (subject.subjectType === 'agent' && subject.agentId === agentId) return;
  if (await canManageAllTeamKeys(deps, subject, binding.teamId)) return;
  throw createProblem('forbidden');
}

async function assertCanManageExistingAgentKey(
  deps: AgentKeyServiceDeps,
  subject: AgentKeySubject,
  binding: ResolvedAgentKeyBinding,
  agentId: string,
  keyId: string,
): Promise<void> {
  if (binding.bindingScope === 'identity') {
    const isAuthorizingCredential = subject.credentialKeyId === keyId;
    const canManageSiblings =
      subject.credentialBindingScope === undefined ||
      subject.scopes.includes('key:manage');
    if (
      subject.subjectType === 'agent' &&
      subject.agentId === agentId &&
      subject.credentialBindingScope !== 'team' &&
      (isAuthorizingCredential || canManageSiblings)
    ) {
      return;
    }
    throw createProblem('not-found');
  }
  if (subject.subjectType === 'agent' && subject.agentId === agentId) return;
  if (await canManageAllTeamKeys(deps, subject, binding.teamId)) return;
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
  const binding = resolveBinding(input);
  if (binding.bindingScope === 'identity') {
    if (
      input.subject.subjectType !== 'agent' ||
      input.subject.credentialBindingScope === 'team'
    ) {
      throw createProblem('forbidden');
    }
    if (input.agentId && input.agentId !== input.subject.agentId) {
      throw createProblem('forbidden');
    }
    const cursorQuery = {
      actorId: input.subject.agentId,
      bindingScope: 'identity' as const,
      status: input.status ?? null,
      teamId: null,
    };
    return {
      agentFilter: input.subject.agentId,
      cursorQuery,
      limit: input.limit ?? DEFAULT_LIST_LIMIT,
      pageToken: decodeCursor(input.cursor, cursorQuery),
    };
  }
  const canManageAll = await canManageAllTeamKeys(
    deps,
    input.subject,
    binding.teamId,
  );
  if (!canManageAll && input.subject.subjectType !== 'agent') {
    throw createProblem('forbidden');
  }
  if (
    !canManageAll &&
    input.agentId &&
    input.agentId !== input.subject.agentId
  ) {
    throw createProblem('forbidden');
  }

  const agentFilter = canManageAll ? input.agentId : input.subject.agentId;
  const cursorQuery = {
    actorId: agentFilter ?? null,
    bindingScope: 'team' as const,
    status: input.status ?? null,
    teamId: binding.teamId,
  };
  return {
    agentFilter,
    cursorQuery,
    limit: input.limit ?? DEFAULT_LIST_LIMIT,
    pageToken: decodeCursor(input.cursor, cursorQuery),
  };
}

async function scanAgentKeyPages(
  api: TalosApi,
  input: ListAgentKeysInput,
  query: ResolvedListQuery,
): Promise<{ items: AgentKey[]; nextCursor: string | null }> {
  const expectedBinding = resolveBinding(input);
  let pageToken = query.pageToken;
  let nextPageToken: string | undefined;
  let scannedCount = 0;
  let talosCalls = 0;
  const seenTokens = new Set<string>();
  const items: AgentKey[] = [];

  // Talos can narrow by actor_id but not by MoltNet's binding metadata. Scan
  // opaque upstream pages and discard keys from the opposite binding, bounded
  // by MAX_TALOS_LIST_PAGES_PER_REQUEST so sparse matches cannot monopolize a
  // request.

  do {
    if (pageToken) {
      if (seenTokens.has(pageToken)) {
        input.logger.warn(
          {
            action: 'list',
            ...bindingLogFields(expectedBinding),
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
          ...bindingLogFields(expectedBinding),
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
        !binding ||
        !bindingsEqual(binding, expectedBinding) ||
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
            ...bindingLogFields(expectedBinding),
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
      ...bindingLogFields(expectedBinding),
      actorId: input.subject.agentId,
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
      const binding = resolveBinding(input);
      const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS;
      const scopes = input.scopes ?? [...AGENT_CREDENTIAL_SCOPES];
      assertDelegableScopes(scopes, input.subject);
      await assertCanManageAgentKey(
        deps,
        input.subject,
        binding,
        input.agentId,
      );
      if (binding.bindingScope === 'team') {
        await assertCurrentAgentMember(deps, binding.teamId, input.agentId);
      }
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
              request_id: talosRequestId(input, binding),
              ttl: `${ttlDays * SECONDS_PER_DAY}s`,
              visibility: KeyVisibility.KeyVisibilitySecret,
              scopes,
              metadata: agentKeyMetadata(binding),
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
            ...bindingLogFields(binding),
          },
          'agent_key.upstream_error',
        );
        throw createProblem('upstream-error', 'Failed to issue agent key');
      }
      if (
        result.issued_api_key &&
        !result.secret &&
        input.recoverReplayByRotation
      ) {
        const replayedKey = toAgentKey(result.issued_api_key);
        result = await api.adminRotateIssuedApiKey(
          {
            keyId: replayedKey.id,
            adminRotateIssuedApiKeyBody: {
              metadata: agentKeyMetadata(binding),
              scopes,
              visibility: KeyVisibility.KeyVisibilitySecret,
            },
          },
          talosInit(input.signal),
        );
        input.logger.warn(
          {
            action: 'issue:replay-recovered',
            keyId: replayedKey.id,
            agentId: input.agentId,
            ...bindingLogFields(binding),
          },
          'agent_key.idempotency_replay_rotated',
        );
      }
      if (result.issued_api_key && !result.secret) {
        input.logger.warn(
          {
            action: 'issue:replay',
            keyId: result.issued_api_key.key_id,
            agentId: input.agentId,
            ...bindingLogFields(binding),
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
        if (
          key.agentId !== input.agentId ||
          !bindingsEqual(key, binding) ||
          !credentialScopeSetsEqual(key.scopes, scopes)
        ) {
          throw new Error('Issued key binding or scopes changed');
        }
      } catch (error) {
        input.logger.warn(
          {
            err: error,
            action: 'issue:validate',
            keyId: result.issued_api_key.key_id,
            agentId: input.agentId,
            ...bindingLogFields(binding),
          },
          'agent_key.malformed_upstream_row',
        );
        await revokeInvalidIssuedKey(
          api,
          result.issued_api_key,
          { agentId: input.agentId, ...binding },
          input.logger,
          'issue',
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
          ...bindingLogFields(binding),
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
      const requestedBinding = resolveBinding(input);
      const { key, binding } = await getBoundKey(
        api,
        input.keyId,
        requestedBinding,
        input.logger,
        'rotate',
        input.signal,
      );
      await assertCanManageExistingAgentKey(
        deps,
        input.subject,
        requestedBinding,
        binding.agentId,
        input.keyId,
      );
      if (input.subject.credentialKeyId === input.keyId) {
        throw createProblem(
          'conflict',
          'The credential being rotated cannot authorize its own rotation. Use OAuth, a different active key, or a team credential manager so a lost response remains recoverable.',
        );
      }
      if (requestedBinding.bindingScope === 'team') {
        await assertCurrentAgentMember(
          deps,
          requestedBinding.teamId,
          binding.agentId,
        );
      }
      const scopes = key.scopes ?? [];
      assertDelegableScopes(scopes, input.subject);

      let result: Awaited<ReturnType<typeof api.adminRotateIssuedApiKey>>;
      try {
        result = await api.adminRotateIssuedApiKey(
          {
            keyId: input.keyId,
            adminRotateIssuedApiKeyBody: {
              metadata: agentKeyMetadata(requestedBinding),
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
            ...bindingLogFields(requestedBinding),
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
          !bindingsEqual(rotatedKey, requestedBinding) ||
          !credentialScopeSetsEqual(rotatedKey.scopes, scopes)
        ) {
          throw new Error('Rotated key binding or scopes changed');
        }
      } catch (error) {
        input.logger.warn(
          {
            err: error,
            action: 'rotate:validate',
            keyId: result.issued_api_key.key_id,
            oldKeyId: input.keyId,
            ...bindingLogFields(requestedBinding),
          },
          'agent_key.malformed_upstream_row',
        );
        await revokeInvalidIssuedKey(
          api,
          result.issued_api_key,
          { agentId: binding.agentId, ...requestedBinding },
          input.logger,
          'rotate',
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
          ...bindingLogFields(requestedBinding),
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
      const requestedBinding = resolveBinding(input);
      const { binding } = await getBoundKey(
        api,
        input.keyId,
        requestedBinding,
        input.logger,
        'revoke',
        input.signal,
      );
      await assertCanManageExistingAgentKey(
        deps,
        input.subject,
        requestedBinding,
        binding.agentId,
        input.keyId,
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
            ...bindingLogFields(requestedBinding),
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
          ...bindingLogFields(requestedBinding),
          reason: input.reason,
        },
        'agent_key.lifecycle',
      );
    },
  };
}
