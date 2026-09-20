import {
  AGENT_OAUTH_SCOPES,
  HUMAN_SESSION_SCOPES,
  LOCAL_CONTROL_SCOPE,
  PROVISIONING_SCOPE,
} from '@moltnet/auth';
import { ResponseError } from '@ory/client-fetch';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockServices, createTestApp } from './helpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const app of apps.splice(0)) await app.close();
});
describe('provisioning grant scope ceiling', () => {
  it.each([null, LOCAL_CONTROL_SCOPE, PROVISIONING_SCOPE])(
    'permits normal human authority and rejects special grant %s',
    async (special) => {
      const mocks = createMockServices();
      mocks.relationshipReader.listTeamIdsAndRolesBySubject.mockResolvedValue(
        [],
      );
      const app = await createTestApp(mocks, {
        subjectType: 'human',
        humanId: 'cccccccc-0000-4000-8000-000000000003',
        identityId: 'dddddddd-0000-4000-8000-000000000004',
        clientId: 'native',
        currentTeamId: null,
        scopes: [...HUMAN_SESSION_SCOPES, ...(special ? [special] : [])],
      });
      apps.push(app);
      const response = await app.inject({
        url: '/teams',
        headers: { authorization: 'Bearer test-grant' },
      });
      expect(response.statusCode).toBe(special ? 401 : 200);
    },
  );
  it.each(['/teams'])('rejects provisioning authority on %s', async (url) => {
    const app = await createTestApp(createMockServices(), {
      subjectType: 'human',
      humanId: 'cccccccc-0000-4000-8000-000000000003',
      identityId: 'dddddddd-0000-4000-8000-000000000004',
      clientId: 'native',
      currentTeamId: null,
      scopes: [PROVISIONING_SCOPE],
      provisioning: {
        agentId: 'aaaaaaaa-0000-4000-8000-000000000001',
        teamId: 'bbbbbbbb-0000-4000-8000-000000000002',
        operation: 'renew',
        scopes: ['task:execute'],
        idempotencyKey: 'same-request',
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: 'Bearer provision' },
      payload: { name: 'Provisioning must not create teams' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('Console consent target validation', () => {
  it('builds approval claims from the Ory request and repeats team permission checks on approval', async () => {
    const mocks = createMockServices();
    const human = {
      subjectType: 'human' as const,
      humanId: 'cccccccc-0000-4000-8000-000000000003',
      identityId: 'dddddddd-0000-4000-8000-000000000004',
      clientId: null,
      currentTeamId: null,
      scopes: [...HUMAN_SESSION_SCOPES],
    };
    const grant = {
      agentId: 'aaaaaaaa-0000-4000-8000-000000000001',
      teamId: 'bbbbbbbb-0000-4000-8000-000000000002',
      operation: 'enroll',
      scopes: ['task:execute'],
      idempotencyKey: 'same-request',
    };
    vi.stubEnv('MOLTNET_NATIVE_OAUTH_CLIENT_ID', 'native');
    const app = await createTestApp(mocks, human);
    apps.push(app);
    app.sessionResolver = {
      evictIdentity: vi.fn(),
      resolveSession: vi.fn().mockResolvedValue(human),
    };
    mocks.permissionChecker.canManageTeamCredentials.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(true);
    mocks.agentRepository.findById.mockResolvedValue({
      id: grant.agentId,
      identityId: 'agent-identity',
      alias: 'Agent',
    } as never);
    mocks.teamRepository.findById.mockResolvedValue({
      id: grant.teamId,
      name: 'Team',
      personal: false,
      status: 'active',
    } as never);
    const url = new URL('https://ory.example/oauth2/auth');
    for (const [key, value] of Object.entries({
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: 'A'.repeat(43),
      instance: 'eeeeeeee-0000-4000-8000-000000000005',
      provisioning: JSON.stringify(grant),
    }))
      url.searchParams.set(key, value);
    app.oauth2Client.getOAuth2ConsentRequest = vi.fn().mockResolvedValue({
      challenge: 'challenge',
      subject: human.identityId,
      client: {
        client_id: 'native',
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        authorization_code_grant_access_token_lifespan: '5m',
      },
      requested_scope: [PROVISIONING_SCOPE],
      requested_access_token_audience: ['moltnet:provisioning'],
      request_url: url.href,
    });
    app.oauth2Client.acceptOAuth2ConsentRequest = vi
      .fn()
      .mockResolvedValue({ redirect_to: 'https://ory.example/approved' });
    const displayed = await app.inject({
      url: '/oauth2/consent?challenge=challenge',
      headers: { cookie: 'ory_kratos_session=session' },
    });
    expect(displayed.statusCode).toBe(200);
    expect(displayed.json()).toMatchObject({
      operation: 'enroll',
      teamId: grant.teamId,
      agentId: grant.agentId,
      permissions: grant.scopes,
    });
    mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(false);
    const rejected = await app.inject({
      method: 'POST',
      url: '/oauth2/consent',
      headers: { cookie: 'ory_kratos_session=session' },
      payload: { challenge: 'challenge', approve: true },
    });
    expect(rejected.statusCode).toBe(403);
    expect(app.oauth2Client.acceptOAuth2ConsentRequest).not.toHaveBeenCalled();
    app.oauth2Client.rejectOAuth2ConsentRequest = vi.fn().mockResolvedValue({
      redirect_to: 'https://ory.example/denied',
    });
    const denied = await app.inject({
      method: 'POST',
      url: '/oauth2/consent',
      headers: { cookie: 'ory_kratos_session=session' },
      payload: { challenge: 'challenge', approve: false },
    });
    expect(denied.statusCode).toBe(200);
    expect(app.oauth2Client.rejectOAuth2ConsentRequest).toHaveBeenCalledWith({
      consentChallenge: 'challenge',
      rejectOAuth2Request: { error: 'access_denied' },
    });
    mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(true);
    const original = await app.oauth2Client.getOAuth2ConsentRequest({
      consentChallenge: 'challenge',
    });
    const plainPkce = new URL(url);
    plainPkce.searchParams.set('code_challenge_method', 'plain');
    const malformed = new URL(url);
    malformed.searchParams.set('provisioning', '{invalid');
    const excessiveScopes = new URL(url);
    excessiveScopes.searchParams.set(
      'provisioning',
      JSON.stringify({ ...grant, scopes: ['key:manage'] }),
    );
    const renewal = new URL(url);
    renewal.searchParams.set(
      'provisioning',
      JSON.stringify({ ...grant, operation: 'renew' }),
    );
    mocks.relationshipReader.isTeamMember.mockResolvedValue(false);
    for (const invalid of [
      { ...original, subject: 'another-human' },
      {
        ...original,
        client: { ...original.client, client_id: 'unregistered-client' },
      },
      { ...original, request_url: plainPkce.href },
      { ...original, requested_scope: [PROVISIONING_SCOPE, 'diary:write'] },
      { ...original, requested_access_token_audience: ['another-api'] },
      { ...original, request_url: renewal.href },
      { ...original, request_url: malformed.href },
      { ...original, request_url: excessiveScopes.href },
    ]) {
      vi.mocked(app.oauth2Client.getOAuth2ConsentRequest).mockResolvedValue(
        invalid,
      );
      const response = await app.inject({
        method: 'POST',
        url: '/oauth2/consent',
        headers: { cookie: 'ory_kratos_session=session' },
        payload: { challenge: 'challenge', approve: true },
      });
      expect(response.statusCode).toBe(403);
    }
    expect(app.oauth2Client.acceptOAuth2ConsentRequest).not.toHaveBeenCalled();
    vi.mocked(app.oauth2Client.getOAuth2ConsentRequest).mockResolvedValue(
      original,
    );
    const approved = await app.inject({
      method: 'POST',
      url: '/oauth2/consent',
      headers: { cookie: 'ory_kratos_session=session' },
      payload: { challenge: 'challenge', approve: true },
    });
    expect(approved.statusCode).toBe(200);
    expect(app.oauth2Client.acceptOAuth2ConsentRequest).toHaveBeenCalledWith({
      consentChallenge: 'challenge',
      acceptOAuth2ConsentRequest: {
        remember: false,
        grant_scope: [PROVISIONING_SCOPE],
        grant_access_token_audience: ['moltnet:provisioning'],
        session: {
          access_token: {
            'moltnet:identity_id': human.identityId,
            'moltnet:human_id': human.humanId,
            'moltnet:subject_type': 'human',
            'moltnet:instance': 'eeeeeeee-0000-4000-8000-000000000005',
            'moltnet:approved_scope': PROVISIONING_SCOPE,
            'moltnet:provisioning': grant,
            'moltnet:delegable_scopes': [...AGENT_OAUTH_SCOPES],
          },
        },
      },
    });
  });
});

describe('Ory challenge failures', () => {
  it.each([
    [400, 400],
    [404, 404],
    [409, 400],
    [410, 404],
    [403, 503],
    [500, 503],
  ])(
    'maps upstream %i to a recoverable %i response',
    async (upstream, expected) => {
      const mocks = createMockServices();
      const human = {
        subjectType: 'human' as const,
        humanId: 'cccccccc-0000-4000-8000-000000000003',
        identityId: 'dddddddd-0000-4000-8000-000000000004',
        clientId: null,
        currentTeamId: null,
        scopes: [...HUMAN_SESSION_SCOPES],
      };
      const app = await createTestApp(mocks, human);
      apps.push(app);
      app.sessionResolver = {
        evictIdentity: vi.fn(),
        resolveSession: vi.fn().mockResolvedValue(human),
      };
      vi.mocked(app.oauth2Client.getOAuth2ConsentRequest).mockRejectedValue(
        new ResponseError(
          new Response(null, { status: upstream }),
          'upstream challenge failure',
        ),
      );
      const response = await app.inject({
        url: '/oauth2/consent?challenge=opaque-challenge',
        headers: { cookie: 'ory_kratos_session=session' },
      });
      expect(response.statusCode).toBe(expected);
      expect(response.body).not.toContain('opaque-challenge');
      expect(
        app.oauth2Client.acceptOAuth2ConsentRequest,
      ).not.toHaveBeenCalled();
    },
  );
});
