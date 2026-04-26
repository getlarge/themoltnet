/**
 * E2E: Hydra Token Hook Wiring
 *
 * Proves that Hydra invokes the rest-api token-exchange webhook on every
 * access-token issuance and that the resulting token's ext claims contain
 * `moltnet:identity_id` and `moltnet:subject_type` for both flows:
 *
 *   - Agent client_credentials  (existing /auth/register agent)
 *   - Human authorization_code  (DCR public client + Kratos login)
 *
 * The token is then used to call a protected rest-api endpoint to confirm
 * end-to-end that requireAuth resolves the AuthContext from the enriched
 * token. Reproduces the prod failure mode where token_hook was missing in
 * Ory: introspection succeeds but no moltnet:identity_id → 401.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { OAuth2Api } from '@ory/client-fetch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createHuman } from './helpers.js';
import {
  createTestHarness,
  HYDRA_PUBLIC_URL,
  type TestHarness,
} from './setup.js';

// PKCE helpers — RFC 7636. We use S256.
function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

interface IntrospectionExt {
  'moltnet:identity_id'?: string;
  'moltnet:subject_type'?: 'agent' | 'human';
  'moltnet:public_key'?: string;
  'moltnet:fingerprint'?: string;
}

async function introspect(
  hydraAdminOAuth2: OAuth2Api,
  token: string,
): Promise<{ active: boolean; ext: IntrospectionExt; clientId?: string }> {
  const data = await hydraAdminOAuth2.introspectOAuth2Token({ token });
  return {
    active: data.active,
    ext: (data.ext ?? {}) as IntrospectionExt,
    clientId: data.client_id ?? undefined,
  };
}

/**
 * Hydra advertises its issuer as the in-network hostname (`http://hydra:4444`)
 * because that's how containers reach it. Tests run on the host where Hydra
 * is exposed at `localhost:4444`, so any `redirect_to` returned by the Hydra
 * Admin API or any `Location` header must be rewritten before we follow it.
 */
function rewriteToHost(url: string): string {
  return url.replace(/^http:\/\/hydra:4444/, HYDRA_PUBLIC_URL);
}

/**
 * Minimal cookie jar — Hydra enforces CSRF via session cookies set on the
 * initial /oauth2/auth call and required on the post-login /oauth2/auth?login_verifier
 * hop. Node's fetch does not jar cookies automatically.
 */
class CookieJar {
  private cookies = new Map<string, string>();

  capture(res: Response): void {
    // Node fetch exposes Set-Cookie via getSetCookie()
    const set = res.headers.getSetCookie?.() ?? [];
    for (const raw of set) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '' || value === 'deleted') {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function jarFetch(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const cookie = jar.header();
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  const res = await fetch(url, { ...init, headers, redirect: 'manual' });
  jar.capture(res);
  return res;
}

describe('Hydra Token Hook E2E', { timeout: 120_000 }, () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Agent: client_credentials ────────────────────────────────

  it('enriches agent client_credentials tokens with moltnet:* claims', async () => {
    const agent = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });

    // The accessToken returned by createAgent was already issued by Hydra
    // (via the rest-api oauth2 proxy → POST /oauth2/token client_credentials).
    // If the token_hook is wired, introspection will surface our ext claims.
    const result = await introspect(
      harness.hydraAdminOAuth2,
      agent.accessToken,
    );

    expect(result.active).toBe(true);
    expect(result.ext['moltnet:identity_id']).toBe(agent.identityId);
    expect(result.ext['moltnet:subject_type']).toBe('agent');
    expect(result.ext['moltnet:fingerprint']).toBeDefined();
    expect(result.ext['moltnet:public_key']).toBeDefined();

    // End-to-end: the token works on a protected rest-api endpoint.
    const diariesRes = await fetch(`${harness.baseUrl}/diaries`, {
      headers: { Authorization: `Bearer ${agent.accessToken}` },
    });
    expect(diariesRes.status).toBe(200);
  });

  // ── Human: DCR + authorization_code ──────────────────────────

  it('enriches human authorization_code tokens via DCR public client', async () => {
    const human = await createHuman({
      kratosPublicFrontend: harness.kratosPublicFrontend,
    });

    // 1. Dynamic Client Registration — public client, PKCE, auth-code only.
    //    Hydra exposes /oauth2/register on the public port (advertised in
    //    /.well-known/openid-configuration as registration_endpoint).
    const dcrRes = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'E2E DCR Human Client',
        redirect_uris: ['http://localhost:9999/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'openid offline_access human:profile diary:read diary:write',
      }),
    });
    expect(dcrRes.status).toBe(201);
    const dcrClient = (await dcrRes.json()) as {
      client_id: string;
      registration_access_token?: string;
    };

    // 2. Drive the auth-code flow. We do NOT follow redirects automatically —
    //    we extract challenges and call Hydra Admin to accept them, mimicking
    //    a real consent UI. A cookie jar is required: Hydra enforces CSRF
    //    via session cookies set on the initial /oauth2/auth call and
    //    required on the post-login_verifier hop.
    const jar = new CookieJar();
    const { verifier, challenge } = generatePkce();
    const state = randomBytes(8).toString('hex');

    const authUrl = new URL(`${HYDRA_PUBLIC_URL}/oauth2/auth`);
    authUrl.searchParams.set('client_id', dcrClient.client_id);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', 'http://localhost:9999/callback');
    authUrl.searchParams.set(
      'scope',
      'openid human:profile diary:read diary:write',
    );
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    // First hop: Hydra → login URL with login_challenge. Hydra may issue
    // intermediate redirects (e.g. canonicalising the issuer URL) before
    // the final hop to the configured login URL.
    let loginChallenge: string | null = null;
    let authNextUrl: string | null = authUrl.toString();
    for (let i = 0; i < 5 && authNextUrl; i++) {
      const res = await jarFetch(jar, authNextUrl);
      const loc = res.headers.get('location');
      if (!loc) break;
      const locUrl = new URL(loc, authNextUrl);
      const lc = locUrl.searchParams.get('login_challenge');
      if (lc) {
        loginChallenge = lc;
        break;
      }
      if (!locUrl.toString().startsWith(HYDRA_PUBLIC_URL)) break;
      authNextUrl = rewriteToHost(locUrl.toString());
    }
    expect(loginChallenge).toBeTruthy();

    // 3. Accept the login challenge as the human's Kratos identity.
    const loginAccept = await harness.hydraAdminOAuth2.acceptOAuth2LoginRequest(
      {
        loginChallenge: loginChallenge as string,
        acceptOAuth2LoginRequest: {
          subject: human.identityId,
          remember: false,
        },
      },
    );

    // 4. Follow the redirect — Hydra → consent URL with consent_challenge.
    // Hydra may bounce through several internal redirects before reaching
    // the consent URL (e.g. issuer URL → /oauth2/auth → consent endpoint),
    // so we follow Location headers until we see consent_challenge or hit
    // a sane cap.
    let consentChallenge: string | null = null;
    let nextUrl: string | null = rewriteToHost(loginAccept.redirect_to);
    const consentRedirectChain: string[] = [];
    for (let i = 0; i < 8 && nextUrl; i++) {
      const res = await jarFetch(jar, nextUrl);
      const loc = res.headers.get('location');
      consentRedirectChain.push(
        `${res.status} ${nextUrl} -> ${loc ?? '(no location)'}`,
      );
      if (!loc) break;
      const locUrl = new URL(loc, nextUrl);
      const cc = locUrl.searchParams.get('consent_challenge');
      if (cc) {
        consentChallenge = cc;
        break;
      }
      if (
        !locUrl.toString().startsWith(HYDRA_PUBLIC_URL) &&
        !loc.startsWith('/')
      )
        break;
      nextUrl = rewriteToHost(locUrl.toString());
    }
    expect(
      consentChallenge,
      `consent_challenge not found in redirect chain:\n${consentRedirectChain.join('\n')}`,
    ).toBeTruthy();

    // 5. Accept consent for the requested scopes.
    const consentAccept =
      await harness.hydraAdminOAuth2.acceptOAuth2ConsentRequest({
        consentChallenge: consentChallenge as string,
        acceptOAuth2ConsentRequest: {
          grant_scope: ['openid', 'human:profile', 'diary:read', 'diary:write'],
          remember: false,
        },
      });

    // 6. Follow back to Hydra — final redirect to redirect_uri with code.
    let code: string | null = null;
    let callbackUrl: string | null = rewriteToHost(consentAccept.redirect_to);
    for (let i = 0; i < 5 && callbackUrl; i++) {
      const res = await jarFetch(jar, callbackUrl);
      const loc = res.headers.get('location');
      if (!loc) break;
      const locUrl = new URL(loc, callbackUrl);
      const c = locUrl.searchParams.get('code');
      if (c) {
        code = c;
        break;
      }
      // Don't follow redirects to a URL that we don't control (e.g. the
      // configured redirect_uri at localhost:9999 has no server). Only
      // follow redirects that stay inside Hydra.
      if (!locUrl.toString().startsWith(HYDRA_PUBLIC_URL)) break;
      callbackUrl = rewriteToHost(locUrl.toString());
    }
    expect(code).toBeTruthy();

    // 7. Exchange the code for an access token at Hydra's public token endpoint.
    //    This is where Hydra invokes the token_hook → rest-api.
    const tokenRes = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: 'http://localhost:9999/callback',
        client_id: dcrClient.client_id,
        code_verifier: verifier,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const tokenBody = (await tokenRes.json()) as {
      access_token: string;
      token_type: string;
    };
    expect(tokenBody.access_token).toBeTruthy();

    // 8. Introspect — must show our ext claims set by the token-exchange hook.
    const result = await introspect(
      harness.hydraAdminOAuth2,
      tokenBody.access_token,
    );
    expect(result.active).toBe(true);
    expect(result.clientId).toBe(dcrClient.client_id);
    expect(result.ext['moltnet:identity_id']).toBe(human.identityId);
    expect(result.ext['moltnet:subject_type']).toBe('human');
    // Humans never get the agent-only key/fingerprint claims.
    expect(result.ext['moltnet:public_key']).toBeUndefined();
    expect(result.ext['moltnet:fingerprint']).toBeUndefined();

    // 9. End-to-end: the token works on a protected rest-api endpoint.
    //    This is the assertion that would have caught the prod 401.
    const diariesRes = await fetch(`${harness.baseUrl}/diaries`, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    expect(diariesRes.status).toBe(200);
  });

  // ── Human: token_hook returns 403 for unknown identity ───────
  //
  // Negative case: if no humans row exists for a Kratos subject, the
  // hook returns 403 → Hydra rejects the token request. This is what
  // would happen in prod if we enable the hook before confirming the
  // human row was created via /hooks/kratos/after-registration.

  it('rejects token issuance when humans row is missing for the subject', async () => {
    const dcrRes = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'E2E DCR Unknown Identity',
        redirect_uris: ['http://localhost:9999/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'openid',
      }),
    });
    expect(dcrRes.status).toBe(201);
    const dcrClient = (await dcrRes.json()) as { client_id: string };

    const jar = new CookieJar();
    const { verifier, challenge } = generatePkce();
    const authUrl = new URL(`${HYDRA_PUBLIC_URL}/oauth2/auth`);
    authUrl.searchParams.set('client_id', dcrClient.client_id);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', 'http://localhost:9999/callback');
    authUrl.searchParams.set('scope', 'openid');
    authUrl.searchParams.set('state', randomBytes(8).toString('hex'));
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    let loginChallenge: string | null = null;
    let authNextUrl: string | null = authUrl.toString();
    for (let i = 0; i < 5 && authNextUrl; i++) {
      const res = await jarFetch(jar, authNextUrl);
      const loc = res.headers.get('location');
      if (!loc) break;
      const locUrl = new URL(loc, authNextUrl);
      const lc = locUrl.searchParams.get('login_challenge');
      if (lc) {
        loginChallenge = lc;
        break;
      }
      if (!locUrl.toString().startsWith(HYDRA_PUBLIC_URL)) break;
      authNextUrl = rewriteToHost(locUrl.toString());
    }
    expect(loginChallenge).toBeTruthy();

    // Accept login as a synthetic Kratos identity that has no humans row.
    const fakeSubject = '00000000-0000-4000-b000-000000000099';
    const loginAccept = await harness.hydraAdminOAuth2.acceptOAuth2LoginRequest(
      {
        loginChallenge: loginChallenge as string,
        acceptOAuth2LoginRequest: { subject: fakeSubject, remember: false },
      },
    );

    let consentChallenge: string | null = null;
    let nextUrl: string | null = rewriteToHost(loginAccept.redirect_to);
    for (let i = 0; i < 8 && nextUrl; i++) {
      const res = await jarFetch(jar, nextUrl);
      const loc = res.headers.get('location');
      if (!loc) break;
      const locUrl = new URL(loc, nextUrl);
      const cc = locUrl.searchParams.get('consent_challenge');
      if (cc) {
        consentChallenge = cc;
        break;
      }
      if (
        !locUrl.toString().startsWith(HYDRA_PUBLIC_URL) &&
        !loc.startsWith('/')
      )
        break;
      nextUrl = rewriteToHost(locUrl.toString());
    }
    expect(consentChallenge).toBeTruthy();

    const consentAccept =
      await harness.hydraAdminOAuth2.acceptOAuth2ConsentRequest({
        consentChallenge: consentChallenge as string,
        acceptOAuth2ConsentRequest: {
          grant_scope: ['openid'],
          remember: false,
        },
      });

    // Hydra calls the token_hook → rest-api returns 403 identity_not_found
    // → Hydra rejects the token request. Exact upstream status varies by
    // Hydra version (commonly 400 or 401 with error: 'access_denied' or
    // 'invalid_request'); the key invariant is that issuance fails and no
    // access_token is returned.
    let code: string | null = null;
    let cbUrl: string | null = rewriteToHost(consentAccept.redirect_to);
    for (let i = 0; i < 5 && cbUrl; i++) {
      const res = await jarFetch(jar, cbUrl);
      const loc = res.headers.get('location');
      if (!loc) break;
      const locUrl = new URL(loc, cbUrl);
      const c = locUrl.searchParams.get('code');
      if (c) {
        code = c;
        break;
      }
      if (!locUrl.toString().startsWith(HYDRA_PUBLIC_URL)) break;
      cbUrl = rewriteToHost(locUrl.toString());
    }
    expect(code).toBeTruthy();

    const tokenRes = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: 'http://localhost:9999/callback',
        client_id: dcrClient.client_id,
        code_verifier: verifier,
      }),
    });
    expect(tokenRes.ok).toBe(false);
    const errBody = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
    };
    expect(errBody.access_token).toBeUndefined();
    expect(errBody.error).toBeTruthy();
  });
});
