import { createHash } from 'node:crypto';

import { AGENT_CREDENTIAL_SCOPES, type OryClients } from '@moltnet/auth';
import { KeyStatus, KeyVisibility } from '@ory/client-fetch';
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

import { createProblem } from '../src/problems/index.js';
import { teamInviteWorkflow } from '../src/workflows/team-invite-workflow.js';
import {
  createMockAgent,
  createMockServices,
  createTestApp,
  OWNER_ID,
  resetMockServices,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

vi.mock('../src/workflows/team-invite-workflow.js', () => ({
  teamInviteWorkflow: { findEnrollment: vi.fn(), run: vi.fn() },
}));
const teamId = 'aaaaaaaa-0000-4000-8000-000000000001';
const inviteId = 'bbbbbbbb-0000-4000-8000-000000000002';
const code = 'mlt_inv_enrollment';
const grant = {
  teamId,
  inviteId,
  role: 'member' as const,
  enrollmentCodeHash: createHash('sha256').update(code).digest('hex'),
};
const talosApi = { getJwks: vi.fn(), adminIssueApiKey: vi.fn() };
const headers = {
  authorization: `Bearer ${TEST_BEARER_TOKEN}`,
  'idempotency-key': 'enroll-request',
};
let app: FastifyInstance;
const mocks = createMockServices();

beforeAll(async () => {
  app = await createTestApp(
    mocks,
    { ...VALID_AUTH_CONTEXT, scopes: ['team:join'] },
    undefined,
    { talosApi: talosApi as unknown as OryClients['apiKeys'] },
  );
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  resetMockServices(mocks);
  vi.clearAllMocks();
  vi.mocked(teamInviteWorkflow.findEnrollment).mockResolvedValue(null);
  vi.mocked(teamInviteWorkflow.run).mockResolvedValue(grant);
  mocks.teamRepository.findInviteByCode.mockResolvedValue({
    id: inviteId,
    teamId,
    expiresAt: new Date(Date.now() + 60_000),
  });
  mocks.teamRepository.findById.mockResolvedValue({
    id: teamId,
    personal: false,
    status: 'active',
  });
  mocks.agentRepository.findById.mockResolvedValue(createMockAgent());
  mocks.relationshipReader.isTeamMember.mockResolvedValue(true);
  talosApi.adminIssueApiKey.mockResolvedValue({
    issued_api_key: {
      key_id: '01JENROLLMENT',
      actor_id: OWNER_ID,
      name: 'Team enrollment',
      scopes: [...AGENT_CREDENTIAL_SCOPES],
      status: KeyStatus.KeyStatusActive,
      visibility: KeyVisibility.KeyVisibilitySecret,
      metadata: {
        schema_version: 2,
        subject_type: 'agent',
        binding_scope: 'team',
        team_id: teamId,
      },
    },
    secret: 'one-time-secret',
  });
});

describe('POST /teams/join enrollment', () => {
  it('issues a team-bound key with team:join alone and no destination header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/teams/join',
      headers,
      payload: { code, issueAgentKey: true },
    });
    expect(response.statusCode).toBe(200);
    expect(
      String(response.headers['cache-control'])
        .split(',')
        .map((directive) => directive.trim()),
    ).toContain('no-store');
    expect(response.json()).toMatchObject({
      teamId,
      role: 'member',
      agentKey: {
        secret: 'one-time-secret',
        key: { agentId: OWNER_ID, bindingScope: 'team', teamId },
      },
    });
    expect(
      mocks.permissionChecker.canManageTeamCredentials,
    ).not.toHaveBeenCalled();
  });

  it.each(['run', 'findEnrollment'] as const)(
    'preserves rejected invite problems from %s without issuing a key',
    async (method) => {
      vi.mocked(teamInviteWorkflow[method]).mockRejectedValue(
        createProblem('invite-exhausted'),
      );
      const response = await app.inject({
        method: 'POST',
        url: '/teams/join',
        headers,
        payload: { code, issueAgentKey: true },
      });
      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({ code: 'INVITE_EXHAUSTED' });
      expect(talosApi.adminIssueApiKey).not.toHaveBeenCalled();
    },
  );

  it('requires the idempotency header before claiming an invite', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/teams/join',
      headers: { authorization: headers.authorization },
      payload: { code, issueAgentKey: true },
    });
    expect(response.statusCode).toBe(400);
    expect(teamInviteWorkflow.run).not.toHaveBeenCalled();
    expect(talosApi.adminIssueApiKey).not.toHaveBeenCalled();
  });
  it('returns exact non-secret reconciliation identifiers on completed replay', async () => {
    const issued = await talosApi.adminIssueApiKey();
    talosApi.adminIssueApiKey.mockResolvedValue({
      issued_api_key: issued.issued_api_key,
    });
    vi.mocked(teamInviteWorkflow.findEnrollment).mockResolvedValue(grant);
    const response = await app.inject({
      method: 'POST',
      url: '/teams/join',
      headers,
      payload: { code, issueAgentKey: true },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      conflict: {
        target: {
          resource: 'agent-key',
          keys: { keyId: '01JENROLLMENT', subjectId: OWNER_ID, teamId },
        },
      },
    });
    expect(response.body).not.toContain('one-time-secret');
    expect(response.body).not.toContain(code);
  });
});
