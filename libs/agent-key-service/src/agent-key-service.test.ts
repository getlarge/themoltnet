import {
  AGENT_CREDENTIAL_SCOPES,
  AGENT_OAUTH_SCOPES,
  KetoNamespace,
} from '@moltnet/auth';
import {
  type IssuedApiKey,
  KeyStatus,
  KeyVisibility,
  RevocationReason,
} from '@ory/client-fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AgentKeyServiceDeps,
  type AgentKeySubject,
  createAgentKeyService,
} from './agent-key-service.js';

type TalosApi = NonNullable<AgentKeyServiceDeps['talosApi']>;

const TEAM_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_TEAM_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_AGENT_ID = '22222222-2222-4222-8222-222222222222';
const KEY_ID = '01JKEY00000000000000000001';
const ROTATED_KEY_ID = '01JKEY00000000000000000002';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

const subject: AgentKeySubject = {
  agentId: AGENT_ID,
  scopes: [...AGENT_OAUTH_SCOPES],
  subjectNs: KetoNamespace.Agent,
  subjectType: 'agent',
};

function issuedKey(overrides: Partial<IssuedApiKey> = {}): IssuedApiKey {
  return {
    key_id: KEY_ID,
    actor_id: AGENT_ID,
    name: 'daemon',
    scopes: [...AGENT_CREDENTIAL_SCOPES],
    status: KeyStatus.KeyStatusActive,
    visibility: KeyVisibility.KeyVisibilitySecret,
    metadata: {
      schema_version: 1,
      subject_type: 'agent',
      team_id: TEAM_ID,
    },
    create_time: new Date('2026-07-24T08:00:00.000Z'),
    expire_time: new Date('2026-08-23T08:00:00.000Z'),
    ...overrides,
  };
}

describe('agent key service', () => {
  const talosApi = {
    adminGetIssuedApiKey: vi.fn<TalosApi['adminGetIssuedApiKey']>(),
    adminIssueApiKey: vi.fn<TalosApi['adminIssueApiKey']>(),
    adminListIssuedApiKeys: vi.fn<TalosApi['adminListIssuedApiKeys']>(),
    adminRevokeIssuedApiKey: vi.fn<TalosApi['adminRevokeIssuedApiKey']>(),
    adminRotateIssuedApiKey: vi.fn<TalosApi['adminRotateIssuedApiKey']>(),
  };
  const agentRepository = {
    findByIdentityId: vi.fn(),
  };
  const permissionChecker = {
    canManageTeamCredentials: vi.fn(),
  };
  const relationshipReader = {
    isTeamMember: vi.fn(),
  };
  const service = createAgentKeyService({
    agentRepository,
    permissionChecker,
    relationshipReader,
    talosApi,
  } as unknown as AgentKeyServiceDeps);

  beforeEach(() => {
    vi.clearAllMocks();
    agentRepository.findByIdentityId.mockResolvedValue({ id: AGENT_ID });
    permissionChecker.canManageTeamCredentials.mockResolvedValue(false);
    relationshipReader.isTeamMember.mockResolvedValue(true);
  });

  it('issues with server-owned binding, scopes, and deterministic request id', async () => {
    talosApi.adminIssueApiKey.mockResolvedValue({
      issued_api_key: issuedKey(),
      secret: 'ory_ak_secret',
    });
    const input = {
      agentId: AGENT_ID,
      idempotencyKey: 'stable-retry-key',
      logger,
      name: ' daemon ',
      subject,
      teamId: TEAM_ID,
    };

    const first = await service.issue(input);
    await service.issue(input);

    expect(first).toMatchObject({
      key: {
        agentId: AGENT_ID,
        bindingScope: 'team',
        teamId: TEAM_ID,
      },
      secret: 'ory_ak_secret',
    });
    const firstRequest =
      talosApi.adminIssueApiKey.mock.calls[0]?.[0].issueApiKeyRequest;
    expect(firstRequest).toMatchObject({
      actor_id: AGENT_ID,
      name: 'daemon',
      scopes: [...AGENT_CREDENTIAL_SCOPES],
      visibility: KeyVisibility.KeyVisibilitySecret,
      metadata: {
        schema_version: 2,
        subject_type: 'agent',
        binding_scope: 'team',
        team_id: TEAM_ID,
      },
    });
    expect(typeof firstRequest?.request_id).toBe('string');
    expect(
      talosApi.adminIssueApiKey.mock.calls[0]?.[0].issueApiKeyRequest
        .request_id,
    ).toBe(
      talosApi.adminIssueApiKey.mock.calls[1]?.[0].issueApiKeyRequest
        .request_id,
    );
  });

  it('issues a credential diluted to the requested scopes', async () => {
    const requestedScopes = ['task:read', 'task:claim'] as const;
    talosApi.adminIssueApiKey.mockResolvedValue({
      issued_api_key: issuedKey({ scopes: [...requestedScopes] }),
      secret: 'ory_ak_diluted',
    });

    const result = await service.issue({
      agentId: AGENT_ID,
      idempotencyKey: 'diluted-key',
      logger,
      name: 'task claimer',
      scopes: [...requestedScopes],
      subject,
      teamId: TEAM_ID,
    });

    expect(result.key.scopes).toEqual(requestedScopes);
    expect(
      talosApi.adminIssueApiKey.mock.calls[0]?.[0].issueApiKeyRequest.scopes,
    ).toEqual(requestedScopes);
  });

  it.each([
    ['binding', { actor_id: OTHER_AGENT_ID }, false],
    ['scopes', { scopes: ['task:read'] as string[] }, true],
  ] as const)(
    'rejects an issued key with mismatched %s without unsafe cleanup',
    async (_kind, overrides, shouldRevoke) => {
      const requestSignal = new AbortController().signal;
      talosApi.adminIssueApiKey.mockResolvedValue({
        issued_api_key: issuedKey(overrides),
        secret: 'ory_ak_invalid',
      });
      talosApi.adminRevokeIssuedApiKey.mockResolvedValue(undefined);

      await expect(
        service.issue({
          agentId: AGENT_ID,
          idempotencyKey: 'invalid-upstream-key',
          logger,
          name: 'invalid upstream key',
          signal: requestSignal,
          subject,
          teamId: TEAM_ID,
        }),
      ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', statusCode: 502 });

      if (shouldRevoke) {
        expect(talosApi.adminRevokeIssuedApiKey).toHaveBeenCalledOnce();
        expect(
          talosApi.adminRevokeIssuedApiKey.mock.calls[0]?.[0],
        ).toMatchObject({ keyId: KEY_ID });
        expect(
          (talosApi.adminRevokeIssuedApiKey.mock.calls[0]?.[1] as RequestInit)
            .signal,
        ).not.toBe(requestSignal);
      } else {
        expect(talosApi.adminRevokeIssuedApiKey).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'issue:cleanup' }),
          'agent_key.cleanup_skipped_untrusted_binding',
        );
      }
    },
  );

  it('isolates invalid-key cleanup failures from issuance', async () => {
    talosApi.adminIssueApiKey.mockResolvedValue({
      issued_api_key: issuedKey({ scopes: ['task:read'] }),
      secret: 'ory_ak_invalid',
    });
    talosApi.adminRevokeIssuedApiKey.mockRejectedValue(
      Object.assign(new Error('cleanup timed out'), { name: 'TimeoutError' }),
    );

    await expect(
      service.issue({
        agentId: AGENT_ID,
        idempotencyKey: 'cleanup-timeout',
        logger,
        name: 'invalid upstream key',
        subject,
        teamId: TEAM_ID,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', statusCode: 502 });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'issue:cleanup',
        failureKind: 'timeout',
        timeoutMs: 2_000,
      }),
      'agent_key.cleanup_failed',
    );
  });

  it('rejects scopes not held by the requesting credential', async () => {
    await expect(
      service.issue({
        agentId: AGENT_ID,
        idempotencyKey: 'scope-escalation',
        logger,
        name: 'escalated key',
        scopes: ['task:read', 'task:execute'],
        subject: { ...subject, scopes: ['key:manage', 'task:read'] },
        teamId: TEAM_ID,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

    expect(talosApi.adminIssueApiKey).not.toHaveBeenCalled();
  });

  it('rejects scopes outside the canonical agent grant', async () => {
    await expect(
      service.issue({
        agentId: AGENT_ID,
        idempotencyKey: 'unknown-scope',
        logger,
        name: 'invalid key',
        scopes: ['human:profile'],
        subject: { ...subject, scopes: [...subject.scopes, 'human:profile'] },
        teamId: TEAM_ID,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      statusCode: 400,
    });

    expect(talosApi.adminIssueApiKey).not.toHaveBeenCalled();
  });

  it('bounds sparse team-manager listings and returns continuation', async () => {
    permissionChecker.canManageTeamCredentials.mockResolvedValue(true);
    talosApi.adminListIssuedApiKeys.mockImplementation(async () => {
      const call = talosApi.adminListIssuedApiKeys.mock.calls.length;
      return {
        issued_api_keys: [
          issuedKey({
            key_id: `other-${call}`,
            metadata: {
              schema_version: 1,
              subject_type: 'agent',
              team_id: OTHER_TEAM_ID,
            },
          }),
        ],
        next_page_token: `page-${call + 1}`,
      };
    });

    const result = await service.list({
      limit: 10,
      logger,
      status: 'active',
      subject,
      teamId: TEAM_ID,
    });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenCalledTimes(5);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        scanBudgetExhausted: true,
        talosCalls: 5,
      }),
      'agent_key.lifecycle',
    );
  });

  it('binds a continuation cursor to its effective query', async () => {
    talosApi.adminListIssuedApiKeys.mockResolvedValue({
      issued_api_keys: [issuedKey()],
      next_page_token: 'next',
    });
    const first = await service.list({
      limit: 1,
      logger,
      subject,
      teamId: TEAM_ID,
    });

    await expect(
      service.list({
        cursor: first.nextCursor!,
        limit: 1,
        logger,
        status: 'revoked',
        subject,
        teamId: TEAM_ID,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      statusCode: 400,
    });
  });

  it('skips malformed upstream rows without failing the list', async () => {
    talosApi.adminListIssuedApiKeys.mockResolvedValue({
      issued_api_keys: [
        issuedKey({ key_id: undefined }),
        issuedKey({ key_id: 'valid-key' }),
      ],
    });

    const result = await service.list({
      logger,
      subject,
      teamId: TEAM_ID,
    });

    expect(result.items.map((key) => key.id)).toEqual(['valid-key']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'list:map' }),
      'agent_key.malformed_upstream_row',
    );
  });

  it('requires authority independent from the key being rotated', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(issuedKey());

    await expect(
      service.rotate({
        keyId: KEY_ID,
        logger,
        subject: { ...subject, credentialKeyId: KEY_ID },
        teamId: TEAM_ID,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(talosApi.adminRotateIssuedApiKey).not.toHaveBeenCalled();
  });

  it('rotates while restoring the immutable binding and secret visibility', async () => {
    const preservedScopes = ['diary:read', 'task:execute'] as const;
    talosApi.adminGetIssuedApiKey.mockResolvedValue(
      issuedKey({ scopes: [...preservedScopes] }),
    );
    talosApi.adminRotateIssuedApiKey.mockResolvedValue({
      issued_api_key: issuedKey({
        key_id: ROTATED_KEY_ID,
        scopes: [...preservedScopes],
      }),
      secret: 'ory_ak_rotated',
    });

    const result = await service.rotate({
      keyId: KEY_ID,
      logger,
      subject,
      teamId: TEAM_ID,
    });

    expect(result.key.id).toBe(ROTATED_KEY_ID);
    expect(talosApi.adminRotateIssuedApiKey.mock.calls[0]?.[0]).toMatchObject({
      keyId: KEY_ID,
      adminRotateIssuedApiKeyBody: {
        visibility: KeyVisibility.KeyVisibilitySecret,
        metadata: {
          schema_version: 2,
          subject_type: 'agent',
          binding_scope: 'team',
          team_id: TEAM_ID,
        },
        scopes: [...preservedScopes],
      },
    });
    expect(result.key.scopes).toEqual(preservedScopes);
  });

  it.each([
    ['binding', { actor_id: OTHER_AGENT_ID }, false],
    ['scopes', { scopes: ['task:read'] as string[] }, true],
  ] as const)(
    'rejects a rotated key with mismatched %s without unsafe cleanup',
    async (_kind, overrides, shouldRevoke) => {
      talosApi.adminGetIssuedApiKey.mockResolvedValue(issuedKey());
      talosApi.adminRotateIssuedApiKey.mockResolvedValue({
        issued_api_key: issuedKey({ key_id: ROTATED_KEY_ID, ...overrides }),
        secret: 'ory_ak_invalid',
      });
      talosApi.adminRevokeIssuedApiKey.mockResolvedValue(undefined);

      await expect(
        service.rotate({
          keyId: KEY_ID,
          logger,
          subject,
          teamId: TEAM_ID,
        }),
      ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', statusCode: 502 });

      if (shouldRevoke) {
        expect(talosApi.adminRevokeIssuedApiKey).toHaveBeenCalledOnce();
        expect(
          talosApi.adminRevokeIssuedApiKey.mock.calls[0]?.[0],
        ).toMatchObject({ keyId: ROTATED_KEY_ID });
      } else {
        expect(talosApi.adminRevokeIssuedApiKey).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'rotate:cleanup' }),
          'agent_key.cleanup_skipped_untrusted_binding',
        );
      }
    },
  );

  it('does not let rotation preserve scopes the requester cannot delegate', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(
      issuedKey({ scopes: ['task:read', 'task:execute'] }),
    );

    await expect(
      service.rotate({
        keyId: KEY_ID,
        logger,
        subject: { ...subject, scopes: ['key:manage', 'task:read'] },
        teamId: TEAM_ID,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

    expect(talosApi.adminRotateIssuedApiKey).not.toHaveBeenCalled();
  });

  it('hides an existing key from an unauthorized agent', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(
      issuedKey({ actor_id: OTHER_AGENT_ID }),
    );

    await expect(
      service.revoke({
        keyId: KEY_ID,
        logger,
        reason: 'key_compromise',
        subject,
        teamId: TEAM_ID,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(talosApi.adminRevokeIssuedApiKey).not.toHaveBeenCalled();
  });

  it('maps an authorized revocation to the upstream contract', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(issuedKey());
    talosApi.adminRevokeIssuedApiKey.mockResolvedValue(undefined);

    await service.revoke({
      description: 'role removed',
      keyId: KEY_ID,
      logger,
      reason: 'privilege_withdrawn',
      subject,
      teamId: TEAM_ID,
    });

    expect(talosApi.adminRevokeIssuedApiKey).toHaveBeenCalledWith(
      {
        keyId: KEY_ID,
        adminRevokeIssuedApiKeyBody: {
          description: 'role removed',
          reason: RevocationReason.RevocationReasonPrivilegeWithdrawn,
        },
      },
      undefined,
    );
  });

  it('issues a canonical identity-scoped key as agent self-service', async () => {
    talosApi.adminIssueApiKey.mockResolvedValue({
      issued_api_key: issuedKey({
        metadata: {
          schema_version: 2,
          subject_type: 'agent',
          binding_scope: 'identity',
        },
      }),
      secret: 'ory_ak_identity',
    });

    const result = await service.issue({
      agentId: AGENT_ID,
      bindingScope: 'identity',
      idempotencyKey: 'identity-retry-key',
      logger,
      name: 'portable agent',
      subject,
    });

    expect(result).toMatchObject({
      key: { agentId: AGENT_ID, bindingScope: 'identity' },
      secret: 'ory_ak_identity',
    });
    expect(result.key).not.toHaveProperty('teamId');
    expect(
      talosApi.adminIssueApiKey.mock.calls[0]?.[0].issueApiKeyRequest.metadata,
    ).toEqual({
      schema_version: 2,
      subject_type: 'agent',
      binding_scope: 'identity',
    });
    expect(relationshipReader.isTeamMember).not.toHaveBeenCalled();
    expect(permissionChecker.canManageTeamCredentials).not.toHaveBeenCalled();
  });

  it.each([
    {
      subject: {
        ...subject,
        subjectNs: KetoNamespace.Human,
        subjectType: 'human' as const,
      },
    },
    {
      subject: {
        ...subject,
        credentialBindingScope: 'team' as const,
        credentialKeyId: 'team-key',
      },
    },
  ])(
    'denies non-identity authorities from identity issuance',
    async ({ subject }) => {
      await expect(
        service.issue({
          agentId: AGENT_ID,
          bindingScope: 'identity',
          idempotencyKey: 'denied-identity-key',
          logger,
          name: 'denied',
          subject,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(talosApi.adminIssueApiKey).not.toHaveBeenCalled();
    },
  );

  it('lists only sibling identity keys and isolates cursors from team queries', async () => {
    talosApi.adminListIssuedApiKeys.mockResolvedValue({
      issued_api_keys: [
        issuedKey(),
        issuedKey({
          key_id: 'identity-key',
          metadata: {
            schema_version: 2,
            subject_type: 'agent',
            binding_scope: 'identity',
          },
        }),
      ],
      next_page_token: 'next',
    });

    const identityPage = await service.list({
      bindingScope: 'identity',
      limit: 1,
      logger,
      subject,
    });

    expect(identityPage.items.map((key) => key.id)).toEqual(['identity-key']);
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenCalledWith(
      expect.objectContaining({ filter: `actor_id="${AGENT_ID}"` }),
      undefined,
    );
    await expect(
      service.list({
        cursor: identityPage.nextCursor!,
        limit: 1,
        logger,
        subject,
        teamId: TEAM_ID,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      statusCode: 400,
    });
  });

  it('rotates a sibling identity key but rejects self-rotation', async () => {
    const identityMetadata = {
      schema_version: 2,
      subject_type: 'agent',
      binding_scope: 'identity',
    };
    talosApi.adminGetIssuedApiKey.mockResolvedValue(
      issuedKey({ metadata: identityMetadata }),
    );
    talosApi.adminRotateIssuedApiKey.mockResolvedValue({
      issued_api_key: issuedKey({
        key_id: ROTATED_KEY_ID,
        metadata: identityMetadata,
      }),
      secret: 'ory_ak_rotated_identity',
    });

    const rotated = await service.rotate({
      bindingScope: 'identity',
      keyId: KEY_ID,
      logger,
      subject: {
        ...subject,
        credentialBindingScope: 'identity',
        credentialKeyId: 'sibling-key',
      },
    });
    expect(rotated.key).toMatchObject({ bindingScope: 'identity' });

    await expect(
      service.rotate({
        bindingScope: 'identity',
        keyId: KEY_ID,
        logger,
        subject: {
          ...subject,
          credentialBindingScope: 'identity',
          credentialKeyId: KEY_ID,
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });

  it('requires key:manage for sibling identity revocation but preserves self-revoke', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(
      issuedKey({
        metadata: {
          schema_version: 2,
          subject_type: 'agent',
          binding_scope: 'identity',
        },
      }),
    );
    talosApi.adminRevokeIssuedApiKey.mockResolvedValue(undefined);
    const restrictedSubject = {
      ...subject,
      credentialBindingScope: 'identity' as const,
      credentialKeyId: 'sibling-key',
      scopes: ['task:read'],
    };

    await expect(
      service.revoke({
        bindingScope: 'identity',
        keyId: KEY_ID,
        logger,
        reason: 'key_compromise',
        subject: restrictedSubject,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(talosApi.adminRevokeIssuedApiKey).not.toHaveBeenCalled();

    await service.revoke({
      bindingScope: 'identity',
      keyId: KEY_ID,
      logger,
      reason: 'key_compromise',
      subject: { ...restrictedSubject, credentialKeyId: KEY_ID },
    });
    expect(talosApi.adminRevokeIssuedApiKey).toHaveBeenCalledOnce();
  });
});
