/**
 * Interactive-connector OAuth for MCP e2e tests.
 *
 * Reproduces what a chat client such as ChatGPT or Codex does before its first
 * MCP call: Dynamic Client Registration of a public client, a Kratos browser
 * login, MoltNet's consent page and a PKCE authorization-code exchange at
 * Hydra's token endpoint, where the token hook runs.
 */
import { createHash, randomBytes } from 'node:crypto';

const DCR_REDIRECT_URI = 'http://localhost:9999/callback';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see globalSetup.ts)`);
  return value;
}

const hydraPublicUrl = () => env('ORY_HYDRA_PUBLIC_URL');
const hydraAdminUrl = () => env('ORY_HYDRA_ADMIN_URL');
const kratosPublicUrl = () => env('ORY_KRATOS_PUBLIC_URL');
const restApiUrl = () => env('REST_API_URL');

export interface E2EHuman {
  identityId: string;
  email: string;
  password: string;
}

export interface ConnectorAuthorization {
  clientId: string;
  accessToken: string;
  refreshToken?: string;
}

async function expectOk(res: Response, step: string): Promise<void> {
  if (!res.ok) {
    throw new Error(`${step} failed: ${res.status} ${await res.text()}`);
  }
}

/** Register a human through Kratos' native API and complete onboarding. */
export async function createHuman(): Promise<E2EHuman> {
  const suffix = randomBytes(4).toString('hex');
  const email = `mcp-human-${suffix}@e2e.local`;
  const password = `e2e-mcp-human-${randomBytes(8).toString('hex')}`;

  const regFlow = await fetch(
    `${kratosPublicUrl()}/self-service/registration/api`,
  );
  await expectOk(regFlow, 'Kratos registration flow');
  const { id: regFlowId } = (await regFlow.json()) as { id: string };
  const registration = await fetch(
    `${kratosPublicUrl()}/self-service/registration?flow=${regFlowId}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'password',
        traits: { email, username: `mcp-human-${suffix}` },
        password,
      }),
    },
  );
  await expectOk(registration, 'Kratos registration');

  // The after-login webhook onboards the human (team, diary) on first login.
  const loginFlow = await fetch(`${kratosPublicUrl()}/self-service/login/api`);
  await expectOk(loginFlow, 'Kratos login flow');
  const { id: loginFlowId } = (await loginFlow.json()) as { id: string };
  const login = await fetch(
    `${kratosPublicUrl()}/self-service/login?flow=${loginFlowId}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'password', identifier: email, password }),
    },
  );
  await expectOk(login, 'Kratos login');
  const session = (await login.json()) as {
    session: { identity: { id: string } };
  };

  return { identityId: session.session.identity.id, email, password };
}

/**
 * Hydra and Kratos advertise in-network hostnames; tests reach them through
 * the host port mappings.
 */
function rewriteToHost(url: string): string {
  return url
    .replace(/^http:\/\/hydra:4444/, hydraPublicUrl())
    .replace(/^http:\/\/kratos:4433/, kratosPublicUrl());
}

/** Host-agnostic cookie jar: Hydra CSRF and the Kratos session ride on it. */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) {
      headers.set(
        'cookie',
        Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join('; '),
      );
    }
    const res = await fetch(url, { ...init, headers, redirect: 'manual' });
    for (const raw of res.headers.getSetCookie()) {
      const [pair = ''] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '' || value === 'deleted') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }
}

async function loginBrowser(jar: CookieJar, human: E2EHuman): Promise<void> {
  const start = await jar.fetch(
    `${kratosPublicUrl()}/self-service/login/browser`,
    { headers: { accept: 'application/json' } },
  );
  await expectOk(start, 'Kratos browser login flow');
  const flow = (await start.json()) as {
    ui: {
      action: string;
      nodes: Array<{ attributes: { name?: string; value?: unknown } }>;
    };
  };
  const csrfToken = flow.ui.nodes.find(
    (node) => node.attributes.name === 'csrf_token',
  )?.attributes.value;
  const login = await jar.fetch(rewriteToHost(flow.ui.action), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      csrf_token: csrfToken,
      identifier: human.email,
      password: human.password,
      method: 'password',
    }),
  });
  await expectOk(login, 'Kratos browser login');
}

/**
 * Follow `Location` headers until one carries `param`, staying inside Hydra
 * (and relative redirects) so the unserved redirect URI is never fetched.
 */
async function followUntilParam(
  jar: CookieJar,
  startUrl: string,
  param: string,
): Promise<string> {
  const chain: string[] = [];
  let next: string | null = startUrl;
  for (let i = 0; i < 8 && next; i++) {
    const res = await jar.fetch(next);
    const location = res.headers.get('location');
    chain.push(`${res.status} ${next} -> ${location ?? '(none)'}`);
    if (!location) break;
    const url = new URL(location, next);
    const value = url.searchParams.get(param);
    if (value) return value;
    const normalised = rewriteToHost(url.toString());
    if (!normalised.startsWith(hydraPublicUrl()) && !location.startsWith('/'))
      break;
    next = normalised;
  }
  throw new Error(`${param} not found in redirect chain:\n${chain.join('\n')}`);
}

/**
 * Authorize a freshly registered connector client for `human`.
 *
 * `requestedScopes` is the authorize request's `scope` parameter. Hydra
 * grants exactly that, whatever `registeredScopes` allowed at registration.
 */
export async function authorizeConnector(
  human: E2EHuman,
  options: {
    clientName: string;
    registeredScopes: readonly string[];
    requestedScopes: readonly string[];
  },
): Promise<ConnectorAuthorization> {
  const registration = await fetch(`${hydraPublicUrl()}/oauth2/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: options.clientName,
      redirect_uris: [DCR_REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: options.registeredScopes.join(' '),
    }),
  });
  await expectOk(registration, 'Dynamic Client Registration');
  const { client_id: clientId } = (await registration.json()) as {
    client_id: string;
  };

  const jar = new CookieJar();
  await loginBrowser(jar, human);

  const verifier = randomBytes(32).toString('base64url');
  const authUrl = new URL(`${hydraPublicUrl()}/oauth2/auth`);
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: DCR_REDIRECT_URI,
    scope: options.requestedScopes.join(' '),
    state: randomBytes(8).toString('hex'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();

  const loginChallenge = await followUntilParam(
    jar,
    authUrl.toString(),
    'login_challenge',
  );

  // Ory owns login; the hosted login UI is outside this repository's e2e
  // surface, so accept it through Hydra Admin.
  const loginAccept = await fetch(
    `${hydraAdminUrl()}/admin/oauth2/auth/requests/login/accept?login_challenge=${encodeURIComponent(loginChallenge)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: human.identityId, remember: false }),
    },
  );
  await expectOk(loginAccept, 'Hydra login accept');
  const { redirect_to: afterLogin } = (await loginAccept.json()) as {
    redirect_to: string;
  };

  const consentChallenge = await followUntilParam(
    jar,
    rewriteToHost(afterLogin),
    'consent_challenge',
  );

  // MoltNet renders and accepts consent itself, from the Kratos session.
  const consent = await jar.fetch(`${restApiUrl()}/oauth2/consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      consent_challenge: consentChallenge,
      decision: 'allow',
    }),
  });
  if (consent.status !== 303) {
    throw new Error(
      `MoltNet consent failed: ${consent.status} ${await consent.text()}`,
    );
  }

  const code = await followUntilParam(
    jar,
    rewriteToHost(consent.headers.get('location')!),
    'code',
  );

  const token = await fetch(`${hydraPublicUrl()}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: DCR_REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  await expectOk(token, 'Authorization code exchange');
  const body = (await token.json()) as {
    access_token: string;
    refresh_token?: string;
  };
  return {
    clientId,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
  };
}

/** Refresh a connector grant the way the client does between sessions. */
export async function refreshConnectorToken(
  authorization: ConnectorAuthorization,
): Promise<string> {
  const res = await fetch(`${hydraPublicUrl()}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: authorization.refreshToken!,
      client_id: authorization.clientId,
    }),
  });
  await expectOk(res, 'Refresh token grant');
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Scopes Hydra recorded on an access token. */
export async function grantedScopes(accessToken: string): Promise<string[]> {
  const res = await fetch(`${hydraAdminUrl()}/admin/oauth2/introspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: accessToken }),
  });
  await expectOk(res, 'Token introspection');
  const body = (await res.json()) as { active: boolean; scope?: string };
  if (!body.active) throw new Error('Introspected token is not active');
  return (body.scope ?? '').split(' ').filter(Boolean);
}
