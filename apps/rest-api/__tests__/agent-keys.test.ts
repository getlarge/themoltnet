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
    mocks.relationshipReader.listTeamMembers.mockResolvedValue([
      {
        subjectId: OWNER_ID,
        subjectNs: 'Agent',
        relation: 'members',
      },
      {
        subjectId: OTHER_AGENT_ID,
        subjectNs: 'Agent',
        relation: 'members',
      },
    ]);
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
        'x-moltnet-team-id': TEAM_ID,
      },
      payload: { agentId: OTHER_AGENT_ID, name: 'worker' },
    });

    expect(response.statusCode).toBe(403);
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
      nextPageToken: null,
    });
    expect(response.body).not.toContain('secret');
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
});
