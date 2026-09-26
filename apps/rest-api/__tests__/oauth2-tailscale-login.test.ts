import type { HumanAuthContext } from '@moltnet/auth';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockServices, createTestApp } from './helpers.js';

const human: HumanAuthContext = {
  subjectType: 'human',
  humanId: 'cccccccc-0000-4000-8000-000000000003',
  identityId: 'dddddddd-0000-4000-8000-000000000004',
  clientId: null,
  currentTeamId: null,
  scopes: [],
  email: 'person@example.com',
  emailVerified: true,
  preferredUsername: 'person',
};
const apps: FastifyInstance[] = [];
const TAILSCALE_REDIRECT_URI = 'https://login.tailscale.com/a/oauth_response';

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function setup(
  overrides: {
    clientId?: string;
    grantTypes?: string[];
    tokenEndpointAuthMethod?: string;
    redirectUris?: string[];
    requestRedirectUri?: string;
    responseTypes?: string[];
    scopes?: string[];
    audience?: string[];
    responseType?: string;
    pkce?: boolean;
    pkceMethod?: string;
    skip?: boolean;
    identity?: HumanAuthContext;
  } = {},
) {
  const app = await createTestApp(createMockServices(), null);
  apps.push(app);
  app.sessionResolver = {
    evictIdentity: vi.fn(),
    resolveSession: vi.fn().mockResolvedValue(overrides.identity ?? human),
  };
  const requestUrl = new URL('https://ory.example/oauth2/auth');
  requestUrl.searchParams.set(
    'response_type',
    overrides.responseType ?? 'code',
  );
  requestUrl.searchParams.set(
    'redirect_uri',
    overrides.requestRedirectUri ?? TAILSCALE_REDIRECT_URI,
  );
  if (overrides.pkce) {
    requestUrl.searchParams.set(
      'code_challenge_method',
      overrides.pkceMethod ?? 'S256',
    );
    requestUrl.searchParams.set('code_challenge', 'A'.repeat(43));
  }
  app.oauth2Client.getOAuth2ConsentRequest = vi.fn().mockResolvedValue({
    subject: human.identityId,
    client: {
      client_id: overrides.clientId ?? 'tailscale-login',
      client_name: 'Tailscale',
      token_endpoint_auth_method:
        overrides.tokenEndpointAuthMethod ?? 'client_secret_basic',
      grant_types: overrides.grantTypes ?? ['authorization_code'],
      response_types: overrides.responseTypes ?? ['code'],
      redirect_uris: overrides.redirectUris ?? [TAILSCALE_REDIRECT_URI],
    },
    requested_scope: overrides.scopes ?? ['openid', 'profile', 'email'],
    requested_access_token_audience: overrides.audience ?? [],
    skip: overrides.skip ?? false,
    request_url: requestUrl.href,
  });
  app.oauth2Client.acceptOAuth2ConsentRequest = vi
    .fn()
    .mockResolvedValue({ redirect_to: 'https://ory.example/approved' });
  app.oauth2Client.rejectOAuth2ConsentRequest = vi
    .fn()
    .mockResolvedValue({ redirect_to: 'https://ory.example/denied' });
  return app;
}

async function decide(app: FastifyInstance, decision: 'allow' | 'deny') {
  return app.inject({
    method: 'POST',
    url: '/oauth2/consent',
    headers: {
      cookie: 'ory_kratos_session=session',
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: new URLSearchParams({
      consent_challenge: 'challenge',
      decision,
    }).toString(),
  });
}

describe('Tailscale OIDC consent', () => {
  it('shows consent and grants only identity scopes with claims from the human session', async () => {
    const app = await setup();
    const displayed = await app.inject({
      url: '/oauth2/consent?consent_challenge=challenge',
      headers: { cookie: 'ory_kratos_session=session' },
    });
    expect(displayed.statusCode).toBe(200);
    expect(displayed.body).toContain('Share your username');
    expect(displayed.body).toContain('Share your email address');

    const approved = await decide(app, 'allow');
    expect(approved.statusCode).toBe(303);
    expect(approved.headers.location).toBe('https://ory.example/approved');
    expect(app.oauth2Client.acceptOAuth2ConsentRequest).toHaveBeenCalledWith({
      consentChallenge: 'challenge',
      acceptOAuth2ConsentRequest: {
        remember: false,
        grant_scope: ['openid', 'profile', 'email'],
        grant_access_token_audience: [],
        session: {
          access_token: { 'moltnet:identity_only_consent': true },
          id_token: {
            email: 'person@example.com',
            email_verified: true,
            name: 'person',
            preferred_username: 'person',
          },
        },
      },
    });
  });

  it('returns access_denied without accepting when the human denies consent', async () => {
    const app = await setup();
    const denied = await decide(app, 'deny');
    expect(denied.statusCode).toBe(303);
    expect(denied.headers.location).toBe('https://ory.example/denied');
    expect(app.oauth2Client.rejectOAuth2ConsentRequest).toHaveBeenCalledWith({
      consentChallenge: 'challenge',
      rejectOAuth2Request: {
        error: 'access_denied',
        error_description: 'The user denied access.',
      },
    });
    expect(app.oauth2Client.acceptOAuth2ConsentRequest).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'another client', clientId: 'tailscale-login-copy', pkce: true },
    {
      name: 'an API scope',
      scopes: ['openid', 'profile', 'email', 'diary:read'],
    },
    { name: 'a missing scope', scopes: ['openid', 'email'] },
    { name: 'a duplicate scope', scopes: ['openid', 'email', 'email'] },
    { name: 'an API audience', audience: ['moltnet:agent-server'] },
    { name: 'a public client', tokenEndpointAuthMethod: 'none' },
    {
      name: 'another grant',
      grantTypes: ['authorization_code', 'refresh_token'],
    },
    { name: 'another response type', responseTypes: ['code', 'token'] },
    {
      name: 'a registered callback',
      redirectUris: ['https://evil.example/callback'],
    },
    {
      name: 'an extra registered callback',
      redirectUris: [TAILSCALE_REDIRECT_URI, 'https://evil.example/callback'],
    },
    {
      name: 'a requested callback',
      requestRedirectUri: 'https://evil.example/callback',
    },
    { name: 'an implicit response', responseType: 'token' },
    { name: 'skipped consent', skip: true },
    { name: 'plain PKCE', pkce: true, pkceMethod: 'plain' },
    { name: 'missing email', identity: { ...human, email: undefined } },
    {
      name: 'missing username',
      identity: { ...human, preferredUsername: undefined },
    },
  ])('rejects $name', async ({ name: _name, ...overrides }) => {
    const app = await setup(overrides);
    const response = await decide(app, 'allow');
    expect(response.statusCode).toBe(403);
    expect(app.oauth2Client.acceptOAuth2ConsentRequest).not.toHaveBeenCalled();
  });

  it('keeps S256 PKCE required for other clients', async () => {
    const app = await setup({
      clientId: 'other-client',
      scopes: ['openid'],
    });
    expect((await decide(app, 'allow')).statusCode).toBe(403);
    expect(app.oauth2Client.acceptOAuth2ConsentRequest).not.toHaveBeenCalled();
  });
});
