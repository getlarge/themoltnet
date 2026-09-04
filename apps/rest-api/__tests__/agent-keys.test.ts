import { AGENT_CREDENTIAL_SCOPES, type OryClients } from '@moltnet/auth';
import { KeyStatus, KeyVisibility, RevocationReason } from '@ory/client-fetch';
import type { FastifyInstance } from 'fastify';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createMockAgent,
  createMockServices,
  createTestApp,
  OTHER_AGENT_ID,
  OWNER_ID,
  resetMockServices,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TEAM_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_TEAM_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const KEY_ID = '01JKEY00000000000000000001';
const ROTATED_KEY_ID = '01JKEY00000000000000000002';
const CREATED_AT = new Date('2026-07-24T08:00:00.000Z');
const EXPIRES_AT = new Date('2099-08-23T08:00:00.000Z');
const IDEMPOTENCY_KEY = 'agent-key-test-request';

function issuedKey(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key_id: KEY_ID,
    actor_id: OWNER_ID,
    name: 'daemon',
    scopes: [...AGENT_CREDENTIAL_SCOPES],
    status: KeyStatus.KeyStatusActive,
    visibility: KeyVisibility.KeyVisibilitySecret,
    metadata: {
      schema_version: 1,
      subject_type: 'agent',
      team_id: TEAM_ID,
    },
    create_time: CREATED_AT,
    expire_time: EXPIRES_AT,
    ...overrides,
  };
}

function identityIssuedKey(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return issuedKey({
    metadata: {
      schema_version: 2,
      subject_type: 'agent',
      binding_scope: 'identity',
    },
    ...overrides,
  });
}

describe('agent key routes', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;
  const talosApi = {
    getJwks: vi.fn(),
    adminGetIssuedApiKey: vi.fn(),
    adminIssueApiKey: vi.fn(),
    adminListIssuedApiKeys: vi.fn(),
    adminRevokeIssuedApiKey: vi.fn(),
    adminRotateIssuedApiKey: vi.fn(),
  };

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(
      mocks,
      VALID_AUTH_CONTEXT,
      undefined,
      {
        talosApi: talosApi as unknown as OryClients['apiKeys'],
      },
      (token) => {
        if (token === 'talos-current-key') {
          return {
            ...VALID_AUTH_CONTEXT,
            credentialBinding: {
              bindingScope: 'team',
              keyId: KEY_ID,
              boundTeamId: TEAM_ID,
            },
          };
        }
        if (token === 'task-only-key') {
          return {
            ...VALID_AUTH_CONTEXT,
            scopes: ['task:execute'],
            credentialBinding: {
              bindingScope: 'team',
              keyId: '01JKEY00000000000000000099',
              boundTeamId: TEAM_ID,
            },
          };
        }
        if (token === 'talos-identity-key') {
          return {
            ...VALID_AUTH_CONTEXT,
            credentialBinding: {
              bindingScope: 'identity',
              keyId: '01JKEY00000000000000000098',
            },
          };
        }
        if (token === 'identity-task-only-key') {
          return {
            ...VALID_AUTH_CONTEXT,
            scopes: ['task:execute'],
            credentialBinding: {
              bindingScope: 'identity',
              keyId: '01JKEY00000000000000000099',
            },
          };
        }
        return VALID_AUTH_CONTEXT;
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
    vi.clearAllMocks();
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeamCredentials.mockResolvedValue(false);
    mocks.relationshipReader.isTeamMember.mockResolvedValue(true);
    mocks.agentRepository.findByIdentityId.mockResolvedValue(createMockAgent());
  });

  it('issues a self-service key with server-owned constraints', async () => {
    talosApi.adminIssueApiKey.mockResolvedValue({
      issued_api_key: issuedKey(),
      secret: 'ory_ak_secret',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': IDEMPOTENCY_KEY,
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { agentId: OWNER_ID, name: ' daemon ' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      key: {
        id: KEY_ID,
        agentId: OWNER_ID,
        bindingScope: 'team',
        teamId: TEAM_ID,
        status: 'active',
      },
      secret: 'ory_ak_secret',
    });
    expect(talosApi.adminIssueApiKey).toHaveBeenCalledWith(
      {
        issueApiKeyRequest: expect.objectContaining({
          actor_id: OWNER_ID,
          name: 'daemon',
          request_id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          ),
          ttl: '2592000s',
          visibility: KeyVisibility.KeyVisibilitySecret,
          scopes: [...AGENT_CREDENTIAL_SCOPES],
          metadata: {
            schema_version: 2,
            subject_type: 'agent',
            binding_scope: 'team',
            team_id: TEAM_ID,
          },
        }),
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('issues a key with an explicitly diluted scope set', async () => {
    const scopes = ['task:read', 'task:claim'];
    talosApi.adminIssueApiKey.mockResolvedValue({
      issued_api_key: issuedKey({ scopes }),
      secret: 'ory_ak_diluted',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'diluted-key-request',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: {
        agentId: OWNER_ID,
        name: 'task claimer',
        scopes,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().key.scopes).toEqual(scopes);
    expect(
      talosApi.adminIssueApiKey.mock.calls[0]?.[0].issueApiKeyRequest.scopes,
    ).toEqual(scopes);
  });

  it('issues an identity-scoped key without a team header', async () => {
    talosApi.adminIssueApiKey.mockResolvedValue({
      issued_api_key: identityIssuedKey(),
      secret: 'ory_ak_identity',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'identity-issue-request',
      },
      payload: {
        agentId: OWNER_ID,
        bindingScope: 'identity',
        name: 'portable agent',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      key: {
        id: KEY_ID,
        agentId: OWNER_ID,
        bindingScope: 'identity',
      },
      secret: 'ory_ak_identity',
    });
    expect(response.json().key).not.toHaveProperty('teamId');
    expect(
      talosApi.adminIssueApiKey.mock.calls[0]?.[0].issueApiKeyRequest.metadata,
    ).toEqual({
      schema_version: 2,
      subject_type: 'agent',
      binding_scope: 'identity',
    });
    expect(mocks.relationshipReader.isTeamMember).not.toHaveBeenCalled();
  });

  it('enforces conditional team headers for both binding scopes', async () => {
    const identityWithTeam = await app.inject({
      method: 'GET',
      url: '/agent-keys?bindingScope=identity',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });
    const teamWithoutHeader = await app.inject({
      method: 'GET',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
      },
    });

    expect(identityWithTeam.statusCode).toBe(400);
    expect(identityWithTeam.json().detail).toContain('not allowed');
    expect(teamWithoutHeader.statusCode).toBe(400);
    expect(teamWithoutHeader.json().detail).toContain('header is required');
    expect(talosApi.adminIssueApiKey).not.toHaveBeenCalled();
  });

  it('denies a team-bound key from identity-scoped lifecycle operations', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/agent-keys?bindingScope=identity',
      headers: { authorization: 'Bearer talos-current-key' },
    });

    expect(response.statusCode).toBe(403);
    expect(talosApi.adminListIssuedApiKeys).not.toHaveBeenCalled();
  });

  it('keeps idempotency request IDs isolated by binding scope', async () => {
    talosApi.adminIssueApiKey
      .mockResolvedValueOnce({
        issued_api_key: issuedKey(),
        secret: 'ory_ak_team',
      })
      .mockResolvedValueOnce({
        issued_api_key: identityIssuedKey(),
        secret: 'ory_ak_identity',
      });

    await app.inject({
      method: 'POST',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'same-request-key',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { agentId: OWNER_ID, name: 'team' },
    });
    await app.inject({
      method: 'POST',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'same-request-key',
      },
      payload: {
        agentId: OWNER_ID,
        bindingScope: 'identity',
        name: 'identity',
      },
    });

    const requestIds = talosApi.adminIssueApiKey.mock.calls.map(
      ([call]) => call.issueApiKeyRequest.request_id,
    );
    expect(requestIds[0]).not.toBe(requestIds[1]);
  });

  it('lets a credential manager issue a key for another agent', async () => {
    mocks.permissionChecker.canManageTeamCredentials.mockResolvedValue(true);
    mocks.agentRepository.findByIdentityId.mockResolvedValue(
      createMockAgent({ identityId: OTHER_AGENT_ID }),
    );
    talosApi.adminIssueApiKey.mockResolvedValue({
      issued_api_key: issuedKey({ actor_id: OTHER_AGENT_ID }),
      secret: 'ory_ak_other',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'manager-issue-request',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { agentId: OTHER_AGENT_ID, name: 'worker', ttlDays: 90 },
    });

    expect(response.statusCode).toBe(201);
    expect(talosApi.adminIssueApiKey).toHaveBeenCalledWith(
      {
        issueApiKeyRequest: expect.objectContaining({
          actor_id: OTHER_AGENT_ID,
          ttl: '7776000s',
        }),
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('does not let an ordinary agent issue a key for another agent', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'forbidden-issue-request',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { agentId: OTHER_AGENT_ID, name: 'worker' },
    });

    expect(response.statusCode).toBe(403);
    expect(talosApi.adminIssueApiKey).not.toHaveBeenCalled();
  });

  it('derives the same Talos request ID from a repeated idempotency key', async () => {
    talosApi.adminIssueApiKey.mockResolvedValue({
      issued_api_key: issuedKey(),
      secret: 'ory_ak_secret',
    });
    const request = {
      method: 'POST' as const,
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': IDEMPOTENCY_KEY,
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { agentId: OWNER_ID, name: 'daemon' },
    };

    await app.inject(request);
    await app.inject(request);

    const firstRequestId =
      talosApi.adminIssueApiKey.mock.calls[0]?.[0].issueApiKeyRequest
        .request_id;
    const secondRequestId =
      talosApi.adminIssueApiKey.mock.calls[1]?.[0].issueApiKeyRequest
        .request_id;
    expect(firstRequestId).toBe(secondRequestId);
  });

  it('reports an idempotency replay without minting another key', async () => {
    talosApi.adminIssueApiKey.mockResolvedValue({
      issued_api_key: issuedKey(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': IDEMPOTENCY_KEY,
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { agentId: OWNER_ID, name: 'daemon' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().detail).toContain('already issued');
    expect(talosApi.adminIssueApiKey).toHaveBeenCalledTimes(1);
  });

  it('rejects a whitespace-only key name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'blank-name-request',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { agentId: OWNER_ID, name: '   ' },
    });

    expect(response.statusCode).toBe(400);
    expect(talosApi.adminIssueApiKey).not.toHaveBeenCalled();
  });

  it('rejects issue when the target agent is no longer a team member', async () => {
    mocks.relationshipReader.isTeamMember.mockResolvedValue(false);

    const response = await app.inject({
      method: 'POST',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'former-member-request',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { agentId: OWNER_ID, name: 'daemon' },
    });

    expect(response.statusCode).toBe(400);
    expect(talosApi.adminIssueApiKey).not.toHaveBeenCalled();
  });

  it('filters Talos results to the active team and self', async () => {
    talosApi.adminListIssuedApiKeys.mockResolvedValue({
      issued_api_keys: [
        issuedKey(),
        issuedKey({
          key_id: '01JKEY00000000000000000003',
          actor_id: OTHER_AGENT_ID,
        }),
        issuedKey({
          key_id: '01JKEY00000000000000000004',
          metadata: {
            schema_version: 1,
            subject_type: 'agent',
            team_id: OTHER_TEAM_ID,
          },
        }),
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        expect.objectContaining({
          id: KEY_ID,
          agentId: OWNER_ID,
          teamId: TEAM_ID,
        }),
      ],
      nextCursor: null,
    });
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenCalledWith(
      {
        filter: `actor_id="${OWNER_ID}"`,
        pageSize: 20,
        pageToken: undefined,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(response.body).not.toContain('secret');
  });

  it('lists, rotates, and revokes sibling identity-scoped keys', async () => {
    talosApi.adminListIssuedApiKeys.mockResolvedValue({
      issued_api_keys: [identityIssuedKey()],
    });
    talosApi.adminGetIssuedApiKey.mockResolvedValue(identityIssuedKey());
    talosApi.adminRotateIssuedApiKey.mockResolvedValue({
      issued_api_key: identityIssuedKey({ key_id: ROTATED_KEY_ID }),
      secret: 'ory_ak_rotated_identity',
    });
    talosApi.adminRevokeIssuedApiKey.mockResolvedValue(undefined);
    const headers = { authorization: 'Bearer talos-identity-key' };

    const listed = await app.inject({
      method: 'GET',
      url: '/agent-keys?bindingScope=identity',
      headers,
    });
    const rotated = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/rotate?bindingScope=identity`,
      headers,
    });
    const revoked = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/revoke?bindingScope=identity`,
      headers,
      payload: { reason: 'superseded' },
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().items[0]).toMatchObject({
      id: KEY_ID,
      bindingScope: 'identity',
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json()).toMatchObject({
      key: { id: ROTATED_KEY_ID, bindingScope: 'identity' },
      secret: 'ory_ak_rotated_identity',
    });
    expect(revoked.statusCode).toBe(204);
    expect(app.tokenValidator.evictTalosKey).toHaveBeenCalledWith(KEY_ID);
  });

  it('denies sibling identity revocation without key:manage', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(identityIssuedKey());

    const response = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/revoke?bindingScope=identity`,
      headers: { authorization: 'Bearer identity-task-only-key' },
      payload: { reason: 'key_compromise' },
    });

    expect(response.statusCode).toBe(404);
    expect(talosApi.adminRevokeIssuedApiKey).not.toHaveBeenCalled();
  });

  it('streams Talos cursors until the MoltNet page is full', async () => {
    talosApi.adminListIssuedApiKeys
      .mockResolvedValueOnce({
        issued_api_keys: [
          issuedKey({
            key_id: '01JKEY00000000000000000003',
            metadata: {
              schema_version: 1,
              subject_type: 'agent',
              team_id: OTHER_TEAM_ID,
            },
          }),
        ],
        next_page_token: 'talos-page-2',
      })
      .mockResolvedValueOnce({
        issued_api_keys: [
          issuedKey({ key_id: '01JKEY00000000000000000004' }),
          issuedKey({ key_id: '01JKEY00000000000000000005' }),
        ],
        next_page_token: 'talos-page-3',
      })
      .mockResolvedValueOnce({
        issued_api_keys: [issuedKey({ key_id: '01JKEY00000000000000000006' })],
      });

    const first = await app.inject({
      method: 'GET',
      url: '/agent-keys?limit=2',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(2);
    expect(first.json().nextCursor).toEqual(expect.any(String));
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenNthCalledWith(
      1,
      {
        filter: `actor_id="${OWNER_ID}"`,
        pageSize: 2,
        pageToken: undefined,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenNthCalledWith(
      2,
      {
        filter: `actor_id="${OWNER_ID}"`,
        pageSize: 2,
        pageToken: 'talos-page-2',
      },
      { signal: expect.any(AbortSignal) },
    );

    const second = await app.inject({
      method: 'GET',
      url: `/agent-keys?limit=2&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      items: [expect.objectContaining({ id: '01JKEY00000000000000000006' })],
      nextCursor: null,
    });
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenNthCalledWith(
      3,
      {
        filter: `actor_id="${OWNER_ID}"`,
        pageSize: 2,
        pageToken: 'talos-page-3',
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('rejects a cursor when the effective query changes', async () => {
    talosApi.adminListIssuedApiKeys.mockResolvedValue({
      issued_api_keys: [issuedKey()],
      next_page_token: 'talos-next',
    });
    const first = await app.inject({
      method: 'GET',
      url: '/agent-keys?limit=1',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    const changedQuery = await app.inject({
      method: 'GET',
      url: `/agent-keys?limit=1&status=revoked&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(changedQuery.statusCode).toBe(400);
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenCalledTimes(1);
  });

  it('uses an unfiltered native cursor for a team-manager list', async () => {
    mocks.permissionChecker.canManageTeamCredentials.mockResolvedValue(true);
    talosApi.adminListIssuedApiKeys.mockResolvedValue({
      issued_api_keys: [issuedKey()],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenCalledWith(
      {
        filter: undefined,
        pageSize: 20,
        pageToken: undefined,
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('returns a continuation cursor when the Talos scan budget is exhausted', async () => {
    mocks.permissionChecker.canManageTeamCredentials.mockResolvedValue(true);
    talosApi.adminListIssuedApiKeys.mockImplementation(
      async ({ pageToken }: { pageToken?: string }) => {
        const page = pageToken ? Number(pageToken.slice('page-'.length)) : 1;
        return {
          issued_api_keys: [
            issuedKey({
              key_id: `01JKEY0000000000000000000${page + 2}`,
              metadata: {
                schema_version: 1,
                subject_type: 'agent',
                team_id: OTHER_TEAM_ID,
              },
            }),
          ],
          next_page_token: `page-${page + 1}`,
        };
      },
    );

    const response = await app.inject({
      method: 'GET',
      url: '/agent-keys?limit=1',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [],
      nextCursor: expect.any(String),
    });
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenCalledTimes(5);
  });

  it('skips malformed Talos rows without failing the list', async () => {
    talosApi.adminListIssuedApiKeys.mockResolvedValue({
      issued_api_keys: [
        issuedKey({ key_id: undefined }),
        issuedKey({ key_id: '01JKEY00000000000000000003' }),
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      expect.objectContaining({ id: '01JKEY00000000000000000003' }),
    ]);
  });

  it('derives expired status from the Talos expiry timestamp', async () => {
    talosApi.adminListIssuedApiKeys.mockResolvedValue({
      issued_api_keys: [
        issuedKey({ expire_time: new Date('2000-01-01T00:00:00.000Z') }),
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/agent-keys?status=expired',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      expect.objectContaining({ id: KEY_ID, status: 'expired' }),
    ]);
  });

  it('fails closed when the credential-manager Keto check errors', async () => {
    mocks.permissionChecker.canManageTeamCredentials.mockRejectedValue(
      new Error('Keto unavailable'),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(500);
    expect(talosApi.adminListIssuedApiKeys).not.toHaveBeenCalled();
  });

  it('rotates immediately while rebuilding immutable metadata', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(issuedKey());
    talosApi.adminRotateIssuedApiKey.mockResolvedValue({
      old_issued_api_key: issuedKey({
        status: KeyStatus.KeyStatusRevoked,
        revocation_reason: RevocationReason.RevocationReasonSuperseded,
      }),
      issued_api_key: issuedKey({ key_id: ROTATED_KEY_ID }),
      secret: 'ory_ak_rotated',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/rotate`,
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      key: { id: ROTATED_KEY_ID, expiresAt: EXPIRES_AT.toISOString() },
      secret: 'ory_ak_rotated',
    });
    expect(talosApi.adminRotateIssuedApiKey).toHaveBeenCalledWith(
      {
        keyId: KEY_ID,
        adminRotateIssuedApiKeyBody: {
          metadata: {
            schema_version: 2,
            subject_type: 'agent',
            binding_scope: 'team',
            team_id: TEAM_ID,
          },
          scopes: [...AGENT_CREDENTIAL_SCOPES],
          visibility: KeyVisibility.KeyVisibilitySecret,
        },
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(app.tokenValidator.evictTalosKey).toHaveBeenCalledWith(KEY_ID);
  });

  it('requires an independent credential to rotate the current Talos key', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(issuedKey());

    const response = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/rotate`,
      headers: {
        authorization: 'Bearer talos-current-key',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      detail: expect.stringContaining('cannot authorize its own rotation'),
    });
    expect(talosApi.adminRotateIssuedApiKey).not.toHaveBeenCalled();
  });

  it('does not let a non-owner rotate another agent key', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(
      issuedKey({ actor_id: OTHER_AGENT_ID }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/rotate`,
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(talosApi.adminRotateIssuedApiKey).not.toHaveBeenCalled();
  });

  it('rejects a rotated key whose immutable binding changed', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(issuedKey());
    talosApi.adminRotateIssuedApiKey.mockResolvedValue({
      old_issued_api_key: issuedKey(),
      issued_api_key: issuedKey({
        key_id: ROTATED_KEY_ID,
        actor_id: OTHER_AGENT_ID,
      }),
      secret: 'ory_ak_rotated',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/rotate`,
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(502);
  });

  it('hides a cross-team key from rotate', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(
      issuedKey({
        metadata: {
          schema_version: 1,
          subject_type: 'agent',
          team_id: OTHER_TEAM_ID,
        },
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/rotate`,
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(talosApi.adminRotateIssuedApiKey).not.toHaveBeenCalled();
  });

  it('rejects rotate when the bound agent is no longer a team member', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(issuedKey());
    mocks.relationshipReader.isTeamMember.mockResolvedValue(false);

    const response = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/rotate`,
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(talosApi.adminRotateIssuedApiKey).not.toHaveBeenCalled();
  });

  it('hides a key bound to another team', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(
      issuedKey({
        metadata: {
          schema_version: 1,
          subject_type: 'agent',
          team_id: OTHER_TEAM_ID,
        },
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/revoke`,
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { reason: 'key_compromise' },
    });

    expect(response.statusCode).toBe(404);
    expect(talosApi.adminRevokeIssuedApiKey).not.toHaveBeenCalled();
  });

  it('evicts a successfully revoked key from the local auth cache', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(issuedKey());
    talosApi.adminRevokeIssuedApiKey.mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/revoke`,
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { reason: 'key_compromise' },
    });

    expect(response.statusCode).toBe(204);
    expect(app.tokenValidator.evictTalosKey).toHaveBeenCalledWith(KEY_ID);
  });

  it('allows an agent to revoke its own key without a management scope', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(issuedKey());
    talosApi.adminRevokeIssuedApiKey.mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/revoke`,
      headers: {
        authorization: 'Bearer task-only-key',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { reason: 'key_compromise' },
    });

    expect(response.statusCode).toBe(204);
    expect(talosApi.adminRevokeIssuedApiKey).toHaveBeenCalledOnce();
  });

  it('rejects key issuance before Keto when key:manage is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agent-keys',
      headers: {
        authorization: 'Bearer task-only-key',
        'idempotency-key': 'scope-denied-request',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { agentId: OWNER_ID, name: 'not-authorized' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      detail: expect.stringContaining('key:manage'),
    });
    expect(mocks.permissionChecker.canAccessTeam).not.toHaveBeenCalled();
    expect(talosApi.adminIssueApiKey).not.toHaveBeenCalled();
  });

  it('validates the privilege-withdrawn description contract', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(issuedKey());

    const response = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/revoke`,
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: {
        reason: 'key_compromise',
        description: 'operator note',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(talosApi.adminRevokeIssuedApiKey).not.toHaveBeenCalled();
  });

  it('does not let a non-owner revoke another agent key', async () => {
    talosApi.adminGetIssuedApiKey.mockResolvedValue(
      issuedKey({ actor_id: OTHER_AGENT_ID }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/agent-keys/${KEY_ID}/revoke`,
      headers: {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { reason: 'key_compromise' },
    });

    expect(response.statusCode).toBe(404);
    expect(talosApi.adminRevokeIssuedApiKey).not.toHaveBeenCalled();
  });

  it('shares one rate-limit bucket across issue, rotate, and revoke', async () => {
    const rateLimitMocks = createMockServices();
    const rateLimitTalosApi = {
      getJwks: vi.fn(),
      adminGetIssuedApiKey: vi.fn().mockResolvedValue(issuedKey()),
      adminIssueApiKey: vi.fn().mockResolvedValue({
        issued_api_key: issuedKey(),
        secret: 'ory_ak_secret',
      }),
      adminListIssuedApiKeys: vi.fn(),
      adminRevokeIssuedApiKey: vi.fn().mockResolvedValue(undefined),
      adminRotateIssuedApiKey: vi.fn().mockResolvedValue({
        old_issued_api_key: issuedKey(),
        issued_api_key: issuedKey({ key_id: ROTATED_KEY_ID }),
        secret: 'ory_ak_rotated',
      }),
    };
    rateLimitMocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    rateLimitMocks.permissionChecker.canManageTeamCredentials.mockResolvedValue(
      false,
    );
    rateLimitMocks.relationshipReader.isTeamMember.mockResolvedValue(true);
    rateLimitMocks.agentRepository.findByIdentityId.mockResolvedValue(
      createMockAgent(),
    );
    const rateLimitApp = await createTestApp(
      rateLimitMocks,
      VALID_AUTH_CONTEXT,
      { rateLimitAgentKey: 3 },
      {
        talosApi: rateLimitTalosApi as unknown as OryClients['apiKeys'],
      },
    );

    try {
      const headers = {
        authorization: 'Bearer test-token',
        'x-moltnet-team-id': TEAM_ID,
      };
      const issued = await rateLimitApp.inject({
        method: 'POST',
        url: '/agent-keys',
        headers: { ...headers, 'idempotency-key': 'rate-limit-issue-1' },
        payload: { agentId: OWNER_ID, name: 'rate-limit' },
      });
      const rotated = await rateLimitApp.inject({
        method: 'POST',
        url: `/agent-keys/${KEY_ID}/rotate`,
        headers,
      });
      const revoked = await rateLimitApp.inject({
        method: 'POST',
        url: `/agent-keys/${ROTATED_KEY_ID}/revoke`,
        headers,
        payload: { reason: 'key_compromise' },
      });
      const limited = await rateLimitApp.inject({
        method: 'POST',
        url: '/agent-keys',
        headers: { ...headers, 'idempotency-key': 'rate-limit-issue-2' },
        payload: { agentId: OWNER_ID, name: 'rate-limit' },
      });

      expect(issued.statusCode).toBe(201);
      expect(rotated.statusCode).toBe(200);
      expect(revoked.statusCode).toBe(204);
      expect(limited.statusCode).toBe(429);
      expect(limited.headers['x-ratelimit-limit']).toBe('3');
    } finally {
      await rateLimitApp.close();
    }
  });
});
