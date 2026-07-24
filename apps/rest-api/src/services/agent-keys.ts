import { randomUUID } from 'node:crypto';

import type {
  KetoNamespace,
  PermissionChecker,
  RelationshipReader,
} from '@moltnet/auth';
import type { AgentRepository } from '@moltnet/database';
import {
  type ApiKeysApi,
  type IssuedApiKey,
  KeyStatus,
  KeyVisibility,
  RevocationReason,
} from '@ory/client-fetch';

import { createProblem, createValidationProblem } from '../problems/index.js';

const DEFAULT_TTL_DAYS = 30;
const TALOS_PAGE_SIZE = 1_000;
const AGENT_KEY_SCOPES = [
  'diary:read',
  'diary:write',
  'crypto:sign',
  'agent:profile',
  'team:read',
] as const;

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
  identityId: string;
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
  logger: Logger;
  name: string;
  subject: AgentKeySubject;
  teamId: string;
  ttlDays?: number;
}

export interface ListAgentKeysInput {
  agentId?: string;
  logger: Logger;
  pageSize?: number;
  pageToken?: string;
  status?: AgentKeyStatus;
  subject: AgentKeySubject;
  teamId: string;
}

export interface RotateAgentKeyInput {
  keyId: string;
  logger: Logger;
  subject: AgentKeySubject;
  teamId: string;
}

export interface RevokeAgentKeyInput {
  description?: string;
  keyId: string;
  logger: Logger;
  reason: AgentKeyRevocationReason;
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
  api: TalosApi,
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

async function assertCurrentAgentMember(
  deps: AgentKeyServiceDeps,
  teamId: string,
  agentId: string,
): Promise<void> {
  const members = await deps.relationshipReader.listTeamMembers(teamId);
  const isAgentMember = members.some(
    (member) => member.subjectNs === 'Agent' && member.subjectId === agentId,
  );
  const agent = await deps.agentRepository.findByIdentityId(agentId);
  if (!isAgentMember || !agent) {
    throw createProblem(
      'validation-failed',
      'Target agent is not a current member of this team',
    );
  }
}

async function listAllIssuedKeys(api: TalosApi): Promise<IssuedApiKey[]> {
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

export function createAgentKeyService(deps: AgentKeyServiceDeps) {
  return {
    async issue(input: IssueAgentKeyInput): Promise<AgentKeyWithSecret> {
      const api = getTalosApi(deps);
      const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS;
      await assertCanManageAgentKey(
        deps,
        input.subject,
        input.teamId,
        input.agentId,
      );
      await assertCurrentAgentMember(deps, input.teamId, input.agentId);

      let result: Awaited<ReturnType<typeof api.adminIssueApiKey>>;
      try {
        result = await api.adminIssueApiKey({
          issueApiKeyRequest: {
            actor_id: input.agentId,
            name: input.name.trim(),
            request_id: randomUUID(),
            ttl: `${ttlDays * 86_400}s`,
            visibility: KeyVisibility.KeyVisibilitySecret,
            scopes: [...AGENT_KEY_SCOPES],
            metadata: {
              schema_version: 1,
              subject_type: 'agent',
              team_id: input.teamId,
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
        key: toAgentKey(result.issued_api_key),
        secret: result.secret,
      };
    },

    async list(input: ListAgentKeysInput): Promise<{
      items: AgentKey[];
      nextPageToken: string | null;
    }> {
      const api = getTalosApi(deps);
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

      let issuedKeys: IssuedApiKey[];
      try {
        issuedKeys = await listAllIssuedKeys(api);
      } catch {
        throw createProblem('upstream-error', 'Failed to list agent keys');
      }

      const agentFilter = canManageAll
        ? input.agentId
        : input.subject.identityId;
      const matching = issuedKeys
        .filter((key) => {
          const binding = readBinding(key);
          return (
            binding?.teamId === input.teamId &&
            (!agentFilter || binding.agentId === agentFilter)
          );
        })
        .map(toAgentKey)
        .filter((key) => !input.status || key.status === input.status)
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

      const offset = decodePageToken(input.pageToken);
      const pageSize = input.pageSize ?? 20;
      const items = matching.slice(offset, offset + pageSize);
      const nextOffset = offset + items.length;

      input.logger.debug(
        {
          action: 'list',
          teamId: input.teamId,
          actorId: input.subject.identityId,
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

    async rotate(input: RotateAgentKeyInput): Promise<AgentKeyWithSecret> {
      const api = getTalosApi(deps);
      const { key, binding } = await getTeamKey(api, input.keyId, input.teamId);
      await assertCanManageAgentKey(
        deps,
        input.subject,
        input.teamId,
        binding.agentId,
      );
      await assertCurrentAgentMember(deps, input.teamId, binding.agentId);

      let result: Awaited<ReturnType<typeof api.adminRotateIssuedApiKey>>;
      try {
        result = await api.adminRotateIssuedApiKey({
          keyId: input.keyId,
          adminRotateIssuedApiKeyBody: {
            metadata: {
              schema_version: 1,
              subject_type: 'agent',
              team_id: input.teamId,
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
        key: toAgentKey(result.issued_api_key),
        secret: result.secret,
      };
    },

    async revoke(input: RevokeAgentKeyInput): Promise<void> {
      const api = getTalosApi(deps);
      const { binding } = await getTeamKey(api, input.keyId, input.teamId);
      await assertCanManageAgentKey(
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
        await api.adminRevokeIssuedApiKey({
          keyId: input.keyId,
          adminRevokeIssuedApiKeyBody: {
            reason: toRevocationReason(input.reason),
            ...(input.description ? { description: input.description } : {}),
          },
        });
      } catch (error) {
        if (isNotFoundError(error)) throw createProblem('not-found');
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
