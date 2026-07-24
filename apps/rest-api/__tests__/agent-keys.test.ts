import type { OryClients } from '@moltnet/auth';
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
const EXPIRES_AT = new Date('2026-08-23T08:00:00.000Z');
const IDEMPOTENCY_KEY = 'agent-key-test-request';

function issuedKey(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key_id: KEY_ID,
    actor_id: OWNER_ID,
    name: 'daemon',
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
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT, undefined, {
      talosApi: talosApi as unknown as OryClients['apiKeys'],
    });
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
        teamId: TEAM_ID,
        status: 'active',
      },
      secret: 'ory_ak_secret',
    });
    expect(talosApi.adminIssueApiKey).toHaveBeenCalledWith({
      issueApiKeyRequest: expect.objectContaining({
        actor_id: OWNER_ID,
        name: 'daemon',
        request_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        ttl: '2592000s',
        visibility: KeyVisibility.KeyVisibilitySecret,
        metadata: {
          schema_version: 1,
          subject_type: 'agent',
          team_id: TEAM_ID,
        },
      }),
    });
    expect(response.headers['cache-control']).toContain('no-store');
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
    expect(talosApi.adminIssueApiKey).toHaveBeenCalledWith({
      issueApiKeyRequest: expect.objectContaining({
        actor_id: OTHER_AGENT_ID,
        ttl: '7776000s',
      }),
    });
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
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenCalledWith({
      filter: `actor_id="${OWNER_ID}"`,
      pageSize: 20,
      pageToken: undefined,
    });
    expect(response.body).not.toContain('secret');
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
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenNthCalledWith(1, {
      filter: `actor_id="${OWNER_ID}"`,
      pageSize: 2,
      pageToken: undefined,
    });
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenNthCalledWith(2, {
      filter: `actor_id="${OWNER_ID}"`,
      pageSize: 2,
      pageToken: 'talos-page-2',
    });

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
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenNthCalledWith(3, {
      filter: `actor_id="${OWNER_ID}"`,
      pageSize: 2,
      pageToken: 'talos-page-3',
    });
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
    expect(talosApi.adminListIssuedApiKeys).toHaveBeenCalledWith({
      filter: undefined,
      pageSize: 20,
      pageToken: undefined,
    });
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
    expect(talosApi.adminRotateIssuedApiKey).toHaveBeenCalledWith({
      keyId: KEY_ID,
      adminRotateIssuedApiKeyBody: expect.objectContaining({
        metadata: {
          schema_version: 1,
          subject_type: 'agent',
          team_id: TEAM_ID,
        },
      }),
    });
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

    expect(response.statusCode).toBe(403);
    expect(talosApi.adminRotateIssuedApiKey).not.toHaveBeenCalled();
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

    expect(response.statusCode).toBe(403);
    expect(talosApi.adminRevokeIssuedApiKey).not.toHaveBeenCalled();
  });
});
