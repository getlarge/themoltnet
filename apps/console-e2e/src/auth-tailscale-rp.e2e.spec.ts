import { createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  Configuration,
  OAuth2Api,
  OidcApi,
  WellknownApi,
} from '@ory/client-fetch';
import { expect, test } from '@playwright/test';

import { CONSOLE_URL, KRATOS_PUBLIC_URL } from './helpers/env.js';
import { submitKratosForm } from './helpers/kratos.js';
import { waitForVerificationCode } from './helpers/mailpit.js';
import { createTestUser } from './helpers/test-user.js';

test('serves the Tailscale OIDC client contract to a mock relying party', async ({
  page,
}) => {
  test.skip(
    process.env['AUTH_UI_MOCK_TAILSCALE_TESTS'] !== '1',
    'Requires an isolated Hydra client namespace and captured mail',
  );
  const publicUrl = process.env['HYDRA_PUBLIC_URL'] ?? 'http://localhost:4444';
  const admin = new OAuth2Api(
    new Configuration({
      basePath: process.env['HYDRA_ADMIN_URL'] ?? 'http://localhost:4445',
    }),
  );
  const definition = JSON.parse(
    readFileSync(
      new URL(
        '../../../infra/ory/oauth2-clients/tailscale-login.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as {
    client_id: string;
    redirect_uris: string[];
    scope: string;
  };
  const callback = definition.redirect_uris[0];
  const secret = randomBytes(32).toString('base64url');
  await admin.createOAuth2Client({
    oAuth2Client: { ...definition, client_secret: secret },
  });
  try {
    const user = createTestUser({ prefix: 'auth-ui-mock-rp' });
    const returnTo = `${CONSOLE_URL}/auth/logout`;
    await page.goto(`${CONSOLE_URL}/auth/registration`);
    await page.locator('input[name="traits.email"]').fill(user.email);
    await page.locator('input[name="traits.username"]').fill(user.username);
    if (!(await page.locator('input[name="password"]').isVisible())) {
      await submitKratosForm(page);
      // With social sign-in enabled, Elements offers a method chooser.
      await page.getByRole('button', { name: /^Password / }).click();
    }
    await page.locator('input[name="password"]').fill(user.password);
    await submitKratosForm(page);
    await expect(page).toHaveURL(/\/auth\/login/);
    await page.goto(
      `${CONSOLE_URL}/auth/login?return_to=${encodeURIComponent(returnTo)}`,
    );
    await page.locator('input[name="identifier"]').fill(user.email);
    if (!(await page.locator('input[name="password"]').isVisible()))
      await submitKratosForm(page);
    await page.locator('input[name="password"]').fill(user.password);
    await submitKratosForm(page);
    await expect(page).toHaveURL(returnTo);
    const sinceIso = new Date().toISOString();
    await page.goto(`${CONSOLE_URL}/auth/verification`);
    await page.locator('input[name="email"]').fill(user.email);
    await submitKratosForm(page);
    const code = await waitForVerificationCode(user.email, { sinceIso });
    await page.locator('input[name="code"]').fill(code);
    await submitKratosForm(page);
    await expect(page.getByText(/verified|success/i).first()).toBeVisible();

    // Capture the final redirect before the browser can contact Tailscale.
    // Routing the destination alone does not intercept redirected requests.
    let sawExternalCallback = false;
    page.on('request', (request) => {
      if (new URL(request.url()).hostname === new URL(callback).hostname)
        sawExternalCallback = true;
    });
    let receivedCallback: URL | undefined;
    const consentPath = '**/oauth2/consent*';
    await page.route(consentPath, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      let response = await route.fetch({ maxRedirects: 0 });
      for (let step = 0; step < 5; step++) {
        const location = response.headers()['location'];
        if (!location) throw new Error('Consent did not return a callback');
        const next = new URL(location, response.url());
        if (
          next.origin === new URL(callback).origin &&
          next.pathname === new URL(callback).pathname
        ) {
          receivedCallback = next;
          return route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<html lang="en"><title>Mock relying party</title><h1>Mock relying party callback</h1></html>',
          });
        }
        if (next.origin !== new URL(publicUrl).origin)
          throw new Error('Unexpected callback origin');
        response = await page.request.get(next.href, { maxRedirects: 0 });
      }
      throw new Error('Too many consent redirects');
    });
    const state = randomUUID();
    const nonce = randomUUID();
    const auth = new URL('/oauth2/auth', publicUrl);
    auth.search = new URLSearchParams({
      client_id: definition.client_id,
      response_type: 'code',
      redirect_uri: callback,
      scope: definition.scope,
      state,
      nonce,
    }).toString();
    await page.goto(auth.href);
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await page.locator('input[name="password"]').fill(user.password);
    await submitKratosForm(page);
    await expect(
      page.getByRole('button', { name: 'Allow', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Mock relying party callback' }),
    ).toBeVisible();
    expect(sawExternalCallback).toBe(false);
    if (!receivedCallback)
      throw new Error('Mock relying party did not receive a callback');
    expect(receivedCallback.searchParams.get('state')).toBe(state);
    const authorizationCode = receivedCallback.searchParams.get('code');
    if (!authorizationCode)
      throw new Error('No authorization code at callback');
    const exchange = await fetch(new URL('/oauth2/token', publicUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${definition.client_id}:${secret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: callback,
        code: authorizationCode,
      }),
    });
    expect(exchange.status).toBe(200);
    const tokens = (await exchange.json()) as { id_token?: string };
    if (!tokens.id_token)
      throw new Error('No identity token at token exchange');
    const [header, payload, signature] = tokens.id_token.split('.');
    const metadata = JSON.parse(
      Buffer.from(header, 'base64url').toString(),
    ) as { alg: string; kid: string };
    expect(metadata.alg).toBe('RS256');
    const configuration = new Configuration({ basePath: publicUrl });
    const keys = await new WellknownApi(configuration).discoverJsonWebKeys();
    const jwk = keys.keys?.find((key) => key.kid === metadata.kid);
    if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e)
      throw new Error('No matching public signing key');
    const key = createPublicKey({
      key: { kty: 'RSA', n: jwk.n, e: jwk.e },
      format: 'jwk',
    });
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        key,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      iss: string;
      aud: string | string[];
      exp: number;
      nonce: string;
      email: string;
      email_verified: boolean;
      preferred_username: string;
    };
    const discovery = await new OidcApi(
      configuration,
    ).discoverOidcConfiguration();
    expect(claims.iss).toBe(discovery.issuer);
    expect([claims.aud].flat()).toContain(definition.client_id);
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(claims.nonce).toBe(nonce);
    expect(claims.email).toBe(user.email);
    expect(claims.email_verified).toBe(true);
    expect(claims.preferred_username).toBe(user.username);
    await page.goto(returnTo);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    expect(
      (await page.request.get(`${KRATOS_PUBLIC_URL}/sessions/whoami`)).status(),
    ).toBe(401);
  } finally {
    await admin.deleteOAuth2Client({ id: definition.client_id });
  }
});
