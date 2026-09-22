import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { OPERATOR_OAUTH } from '@moltnet/models';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHuman, type TestHuman } from './helpers.js';
import {
  createTestHarness,
  HYDRA_PUBLIC_URL,
  KRATOS_PUBLIC_URL,
  SERVER_BASE_URL,
  type TestHarness,
} from './setup.js';

const CLIENT_ID = 'moltnet-native-e2e';
const REDIRECT_URI = 'http://127.0.0.1:17375/oauth/callback';

function rewriteToHost(url: string): string {
  return url
    .replace(/^http:\/\/hydra:4444/, HYDRA_PUBLIC_URL)
    .replace(/^http:\/\/kratos:4433/, KRATOS_PUBLIC_URL);
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  capture(response: Response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index > 0)
        this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const cookie = Array.from(
      this.cookies,
      ([name, value]) => `${name}=${value}`,
    ).join('; ');
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    const response = await fetch(rewriteToHost(url), {
      ...init,
      redirect: 'manual',
      headers,
    });
    this.capture(response);
    return response;
  }
}

interface KratosBrowserFlow {
  id: string;
  ui: {
    action: string;
    nodes: Array<{ attributes: { name?: string; value?: unknown } }>;
  };
}

async function loginBrowser(jar: CookieJar, human: TestHuman): Promise<void> {
  const start = await jar.fetch(
    `${KRATOS_PUBLIC_URL}/self-service/login/browser`,
    { headers: { accept: 'application/json' } },
  );
  expect(start.status, await start.clone().text()).toBe(200);
  const flow = (await start.json()) as KratosBrowserFlow;
  const csrfToken = flow.ui.nodes.find(
    (node) => node.attributes.name === 'csrf_token',
  )?.attributes.value;
  expect(typeof csrfToken).toBe('string');

  const login = await jar.fetch(flow.ui.action, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      csrf_token: csrfToken,
      identifier: human.email,
      password: human.password,
      method: 'password',
    }),
  });
  expect(login.status, await login.clone().text()).toBe(200);
}

async function challengeFromRedirects(
  jar: CookieJar,
  start: string,
  parameter: 'login_challenge' | 'consent_challenge',
): Promise<string> {
  let next = rewriteToHost(start);
  for (let index = 0; index < 8; index++) {
    const response = await jar.fetch(next);
    const location = response.headers.get('location');
    if (!location) break;
    const url = new URL(location, next);
    const challenge = url.searchParams.get(parameter);
    if (challenge) return challenge;
    next = rewriteToHost(url.href);
  }
  throw new Error(`${parameter} was not returned by Hydra`);
}

async function codeFromRedirects(
  jar: CookieJar,
  start: string,
): Promise<string> {
  let next = rewriteToHost(start);
  for (let index = 0; index < 8; index++) {
    const response = await jar.fetch(next);
    const location = response.headers.get('location');
    if (!location) break;
    const url = new URL(location, next);
    const code = url.searchParams.get('code');
    if (code) return code;
    next = rewriteToHost(url.href);
  }
  throw new Error('authorization code was not returned by Hydra');
}

describe('operator OAuth authorization code E2E', { timeout: 120_000 }, () => {
  let harness: TestHarness;
  let human: TestHuman;

  beforeAll(async () => {
    harness = await createTestHarness();
    human = await createHuman({
      kratosPublicFrontend: harness.kratosPublicFrontend,
    });
    const client = {
      client_id: CLIENT_ID,
      client_name: 'MoltNet Desktop E2E',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: `${OPERATOR_OAUTH.provisioningScope} ${OPERATOR_OAUTH.localControlScope}`,
      audience: [
        OPERATOR_OAUTH.provisioningAudience,
        OPERATOR_OAUTH.localControlAudience,
      ],
      redirect_uris: [REDIRECT_URI],
      authorization_code_grant_access_token_lifespan: '5m',
      skip_consent: false,
    };
    try {
      await harness.hydraAdminOAuth2.getOAuth2Client({ id: CLIENT_ID });
      await harness.hydraAdminOAuth2.setOAuth2Client({
        id: CLIENT_ID,
        oAuth2Client: client,
      });
    } catch (error) {
      if ((error as { response?: Response }).response?.status !== 404)
        throw error;
      await harness.hydraAdminOAuth2.createOAuth2Client({
        oAuth2Client: client,
      });
    }
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  async function exchangeDirect(
    scope: string,
    audience: string,
    approved: Record<string, unknown>,
  ) {
    const jar = new CookieJar();
    const verifier = randomBytes(32).toString('base64url');
    const auth = new URL(`${HYDRA_PUBLIC_URL}/oauth2/auth`);
    for (const [key, value] of Object.entries({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope,
      audience,
      state: randomUUID(),
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }))
      auth.searchParams.set(key, value);

    const loginChallenge = await challengeFromRedirects(
      jar,
      auth.href,
      'login_challenge',
    );
    const login = await harness.hydraAdminOAuth2.acceptOAuth2LoginRequest({
      loginChallenge,
      acceptOAuth2LoginRequest: {
        subject: human.identityId,
        remember: false,
      },
    });
    const consentChallenge = await challengeFromRedirects(
      jar,
      login.redirect_to,
      'consent_challenge',
    );
    const consent = await harness.hydraAdminOAuth2.acceptOAuth2ConsentRequest({
      consentChallenge,
      acceptOAuth2ConsentRequest: {
        remember: false,
        grant_scope: [scope],
        grant_access_token_audience: [audience],
        session: {
          access_token: {
            'moltnet:identity_id': human.identityId,
            'moltnet:human_id': human.humanId,
            'moltnet:subject_type': 'human',
            'moltnet:approved_scope': scope,
            ...approved,
          },
        },
      },
    });
    const code = await codeFromRedirects(jar, consent.redirect_to);
    return fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code,
        code_verifier: verifier,
      }),
    });
  }

  async function exchangeThroughApprovalRoute() {
    const jar = new CookieJar();
    await loginBrowser(jar, human);
    const verifier = randomBytes(32).toString('base64url');
    const instance = randomUUID();
    const auth = new URL(`${HYDRA_PUBLIC_URL}/oauth2/auth`);
    for (const [key, value] of Object.entries({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: OPERATOR_OAUTH.localControlScope,
      audience: OPERATOR_OAUTH.localControlAudience,
      state: randomUUID(),
      instance,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }))
      auth.searchParams.set(key, value);

    const loginChallenge = await challengeFromRedirects(
      jar,
      auth.href,
      'login_challenge',
    );
    const login = await harness.hydraAdminOAuth2.acceptOAuth2LoginRequest({
      loginChallenge,
      acceptOAuth2LoginRequest: {
        subject: human.identityId,
        remember: false,
      },
    });

    const consentChallenge = await challengeFromRedirects(
      jar,
      login.redirect_to,
      'consent_challenge',
    );
    const approval = await jar.fetch(
      `${SERVER_BASE_URL}/oauth2/consent?consent_challenge=${encodeURIComponent(consentChallenge)}`,
    );
    expect(approval.status, await approval.clone().text()).toBe(200);
    const approvalHtml = await approval.text();
    expect(approvalHtml).toContain('Allow local Agent Server control?');
    expect(approvalHtml).toContain('Control this Agent Server instance');
    expect(approvalHtml).toContain('The requesting local Agent Server');

    const consent = await jar.fetch(`${SERVER_BASE_URL}/oauth2/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        consent_challenge: consentChallenge,
        decision: 'allow',
      }),
    });
    expect(consent.status, await consent.clone().text()).toBe(303);
    const consentRedirect = consent.headers.get('location');
    expect(consentRedirect).toBeTruthy();
    const code = await codeFromRedirects(jar, consentRedirect!);
    return {
      instance,
      response: await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          code,
          code_verifier: verifier,
        }),
      }),
    };
  }

  it('issues local-control claims through the MoltNet approval hooks', async () => {
    const { instance, response } = await exchangeThroughApprovalRoute();
    expect(response.status, await response.clone().text()).toBe(200);
    const token = (await response.json()) as { access_token?: string };
    expect(token.access_token).toBeTruthy();
    const introspection = await harness.hydraAdminOAuth2.introspectOAuth2Token({
      token: token.access_token!,
    });
    expect(introspection.ext).toMatchObject({
      'moltnet:identity_id': human.identityId,
      'moltnet:subject_type': 'human',
      'moltnet:instance': instance,
    });
  });

  it.each([
    {
      name: 'local operator sign-in',
      scope: OPERATOR_OAUTH.localControlScope,
      audience: OPERATOR_OAUTH.localControlAudience,
      extra: { 'moltnet:instance': randomUUID() },
    },
    {
      name: 'team credential provisioning',
      scope: OPERATOR_OAUTH.provisioningScope,
      audience: OPERATOR_OAUTH.provisioningAudience,
      extra: {
        'moltnet:instance': randomUUID(),
        'moltnet:provisioning': {
          agentId: randomUUID(),
          teamId: randomUUID(),
          operation: 'renew',
          scopes: ['task:read'],
          idempotencyKey: randomUUID(),
        },
        'moltnet:delegable_scopes': ['key:manage', 'task:read'],
      },
    },
  ])(
    'issues the native token for $name',
    async ({ scope, audience, extra }) => {
      const response = await exchangeDirect(scope, audience, extra);
      expect(response.status, await response.clone().text()).toBe(200);
      const token = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
      };
      expect(token.access_token).toBeTruthy();
      expect(token.refresh_token).toBeUndefined();
      const introspection =
        await harness.hydraAdminOAuth2.introspectOAuth2Token({
          token: token.access_token!,
        });
      expect(introspection.active).toBe(true);
      expect(introspection.client_id).toBe(CLIENT_ID);
      expect(introspection.scope).toBe(scope);
      expect(introspection.ext).toMatchObject({
        'moltnet:identity_id': human.identityId,
        'moltnet:subject_type': 'human',
        ...extra,
      });
    },
  );
});
