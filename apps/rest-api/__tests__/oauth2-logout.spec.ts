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
  email: 'person@example.test',
  emailVerified: true,
  preferredUsername: 'person',
};
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function setup(subject = human.identityId) {
  const app = await createTestApp(createMockServices(), null);
  apps.push(app);
  app.sessionResolver = {
    evictIdentity: vi.fn(),
    resolveSession: vi.fn().mockResolvedValue(human),
  };
  app.oauth2Client.getOAuth2LogoutRequest = vi
    .fn()
    .mockResolvedValue({ subject });
  app.oauth2Client.acceptOAuth2LogoutRequest = vi
    .fn()
    .mockResolvedValue({
      redirect_to: 'https://oauth.example.test/logout-verifier',
    });
  return app;
}

describe('browser OAuth logout confirmation', () => {
  it('approves only the cookie-bound identity and returns Hydra continuation without caching', async () => {
    const app = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/logout',
      headers: { cookie: 'ory_kratos_session=synthetic' },
      payload: { logoutChallenge: 'challenge' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      redirectTo: 'https://oauth.example.test/logout-verifier',
    });
    expect(response.headers['cache-control']).toContain('no-store');
    expect(app.oauth2Client.acceptOAuth2LogoutRequest).toHaveBeenCalledWith({
      logoutChallenge: 'challenge',
    });
  });

  it('does not accept a logout challenge belonging to another identity', async () => {
    const app = await setup('another-identity');
    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/logout',
      headers: { cookie: 'ory_kratos_session=synthetic' },
      payload: { logoutChallenge: 'challenge' },
    });
    expect(response.statusCode).toBe(403);
    expect(app.oauth2Client.acceptOAuth2LogoutRequest).not.toHaveBeenCalled();
  });

  it('does not borrow bearer authority when the browser cookie is absent', async () => {
    const app = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/logout',
      payload: { logoutChallenge: 'challenge' },
    });
    expect(response.statusCode).toBe(401);
    expect(app.oauth2Client.getOAuth2LogoutRequest).not.toHaveBeenCalled();
  });

  it('rejects a safelisted form submission before approving logout', async () => {
    const app = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/logout',
      headers: {
        cookie: 'ory_kratos_session=synthetic',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'logoutChallenge=challenge',
    });
    expect(response.statusCode).toBe(400);
    expect(app.oauth2Client.acceptOAuth2LogoutRequest).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin browser request before approving logout', async () => {
    const app = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/logout',
      headers: {
        cookie: 'ory_kratos_session=synthetic',
        origin: 'https://untrusted.example.test',
      },
      payload: { logoutChallenge: 'challenge' },
    });
    expect(response.statusCode).not.toBe(200);
    expect(app.oauth2Client.acceptOAuth2LogoutRequest).not.toHaveBeenCalled();
  });
});
