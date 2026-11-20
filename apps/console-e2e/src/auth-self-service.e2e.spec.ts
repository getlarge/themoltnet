import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Configuration, OAuth2Api } from '@ory/client-fetch';
import { expect, type Page, test } from '@playwright/test';

import { CONSOLE_URL, KRATOS_PUBLIC_URL } from './helpers/env.js';
import {
  readTotpSecret,
  submitKratosForm as submitMethod,
} from './helpers/kratos.js';
import { waitForVerificationCode } from './helpers/mailpit.js';
import { createTestUser } from './helpers/test-user.js';
import { generateTotpCode, waitForFreshTotpWindow } from './helpers/totp.js';

// This opt-in suite also runs against an externally provisioned backend. Inputs
// describe endpoints and fixtures, never a hosting provider. Do not enable it
// against production or against a restored snapshot reserved for migration.
test.describe.serial('Console self-service authentication', () => {
  test.skip(
    process.env['AUTH_UI_TESTS'] !== '1',
    'Requires an isolated synthetic authentication fixture',
  );
  const user = createTestUser({ prefix: 'auth-ui' });
  const returnTo = `${CONSOLE_URL}/auth/logout`;
  let totpSecret: string;

  async function login(page: Page) {
    await page.goto(
      `${CONSOLE_URL}/auth/login?return_to=${encodeURIComponent(returnTo)}`,
    );
    await page.locator('input[name="identifier"]').fill(user.email);
    if (!(await page.locator('input[name="password"]').isVisible()))
      await submitMethod(page);
    await page.locator('input[name="password"]').fill(user.password);
    await submitMethod(page);
    if (totpSecret) {
      await waitForFreshTotpWindow();
      await page
        .locator('input[name="totp_code"]')
        .fill(generateTotpCode(totpSecret));
      await submitMethod(page);
    }
    await expect(page).toHaveURL(returnTo);
  }

  test('keeps anonymous forms usable on mobile and in both themes', async ({
    page,
  }) => {
    test.skip(
      process.env['AUTH_UI_VISUAL_TESTS'] !== '1',
      'Opt-in screenshot baselines',
    );
    for (const mode of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
      for (const [label, width, height] of [
        ['desktop', 1280, 900],
        ['mobile', 390, 844],
      ] as const) {
        await page.setViewportSize({ width, height });
        await page.goto(`${CONSOLE_URL}/auth/login`);
        await expect(page.locator('input[name="identifier"]')).toBeVisible();
        expect(
          await page
            .locator('body')
            .evaluate((body) => body.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.keyboard.press('Tab');
        await expect(page.locator(':focus-visible')).toBeVisible();
        await expect(page).toHaveScreenshot(`login-${mode}-${label}.png`, {
          animations: 'disabled',
        });
      }
    }
    await page.goto(
      `${CONSOLE_URL}/auth/login?flow=11111111-1111-4111-8111-111111111111`,
    );
    await expect(page.getByRole('alert')).toContainText('previous form');
    await expect(page).toHaveScreenshot('login-expired-mobile.png', {
      animations: 'disabled',
    });
  });

  test('registers without auto-login, validates credentials, persists session and signs out', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${CONSOLE_URL}/auth/registration`);
    await page.locator('input[name="traits.email"]').fill(user.email);
    const username = page.locator('input[name="traits.username"]');
    if (await username.isVisible()) await username.fill(user.username);
    if (!(await page.locator('input[name="password"]').isVisible()))
      await submitMethod(page);
    await page.locator('input[name="password"]').fill(user.password);
    await submitMethod(page);
    await expect(page).toHaveURL(/\/auth\/login/);
    expect(
      (await page.request.get(`${KRATOS_PUBLIC_URL}/sessions/whoami`)).status(),
    ).toBe(401);

    await page.locator('input[name="identifier"]').fill(user.email);
    if (!(await page.locator('input[name="password"]').isVisible()))
      await submitMethod(page);
    await page
      .locator('input[name="password"]')
      .fill('incorrect-synthetic-password');
    await submitMethod(page);
    await expect(
      page.getByText(/provided credentials are invalid/i),
    ).toBeVisible();
    await login(page);
    await page.reload();
    expect(
      (await page.request.get(`${KRATOS_PUBLIC_URL}/sessions/whoami`)).ok(),
    ).toBe(true);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('input[name="identifier"]')).toBeVisible();
    expect(
      (await page.request.get(`${KRATOS_PUBLIC_URL}/sessions/whoami`)).status(),
    ).toBe(401);
    expect(errors).toEqual([]);
  });

  test('restarts a missing flow and lets the backend reject unsafe return URLs', async ({
    page,
  }) => {
    await page.goto(
      `${CONSOLE_URL}/auth/login?flow=11111111-1111-4111-8111-111111111111&return_to=${encodeURIComponent(returnTo)}`,
    );
    await expect(page.locator('input[name="identifier"]')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('previous form');
    await page.goto(
      `${CONSOLE_URL}/auth/login?return_to=${encodeURIComponent('https://untrusted.example.test/')}`,
    );
    await expect(
      page.getByRole('heading', { name: 'Unable to continue' }),
    ).toBeVisible();
    expect(new URL(page.url()).origin).toBe(new URL(CONSOLE_URL).origin);
  });

  test('retains the return destination when CSRF protection restarts a submitted form', async ({
    page,
  }) => {
    await page.goto(
      `${CONSOLE_URL}/auth/login?return_to=${encodeURIComponent(returnTo)}`,
    );
    await page.locator('input[name="identifier"]').fill(user.email);
    if (!(await page.locator('input[name="password"]').isVisible()))
      await submitMethod(page);
    await page.locator('input[name="password"]').fill(user.password);
    const previousFlow = new URL(page.url()).searchParams.get('flow');
    await page.context().clearCookies({ name: /csrf/ });
    await submitMethod(page);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('flow'))
      .not.toBe(previousFlow);
    await expect(page.locator('input[name="identifier"]')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('return_to')).toBe(returnTo);
  });

  test('restarts an expired flow without losing its return destination', async ({
    page,
  }) => {
    test.skip(
      process.env['AUTH_UI_EXPIRY_TESTS'] !== '1',
      'Requires a short-lived flow fixture',
    );
    await page.goto(
      `${CONSOLE_URL}/auth/login?return_to=${encodeURIComponent(returnTo)}`,
    );
    await expect(page.locator('input[name="identifier"]')).toBeVisible();
    const expiredId = new URL(page.url()).searchParams.get('flow');
    if (!expiredId) throw new Error('Login did not initialize a flow');
    await expect
      .poll(
        async () =>
          (
            await page.request.get(
              `${KRATOS_PUBLIC_URL}/self-service/login/flows?id=${expiredId}`,
            )
          ).status(),
        { timeout: 30_000, intervals: [1000, 2000] },
      )
      .toBe(410);
    await page.reload();
    await expect(page.locator('input[name="identifier"]')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('flow')).not.toBe(expiredId);
    expect(new URL(page.url()).searchParams.get('return_to')).toBe(returnTo);
    await expect(page.getByRole('alert')).toContainText('previous form');
  });

  test('verifies email and recovers the account through backend codes', async ({
    page,
  }) => {
    let sinceIso = new Date().toISOString();
    await page.goto(`${CONSOLE_URL}/auth/verification`);
    await page.locator('input[name="email"]').fill(user.email);
    await submitMethod(page);
    let code = await waitForVerificationCode(user.email, { sinceIso });
    await page.locator('input[name="code"]').fill(code);
    await submitMethod(page);
    await expect(page.getByText(/verified|success/i).first()).toBeVisible();

    sinceIso = new Date().toISOString();
    await page.goto(`${CONSOLE_URL}/auth/recovery`);
    await page.locator('input[name="email"]').fill(user.email);
    await submitMethod(page);
    code = await waitForVerificationCode(user.email, { sinceIso });
    await page.locator('input[name="code"]').fill(code);
    await submitMethod(page);
    await expect(page).toHaveURL(/\/auth\/settings/);
    await expect(page.locator('input[name="password"]')).toBeVisible();
    const password = page.locator('input[name="password"]');
    user.password += 'Reset';
    await password.fill(user.password);
    const settingsNavigation = page
      .waitForEvent('framenavigated', {
        predicate: (frame) => frame === page.mainFrame(),
      })
      .catch(() => null);
    const saved = page
      .waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/self-service/settings' &&
          response.request().method() === 'POST',
      )
      .then(async (response) => ({
        status: response.status(),
        body: (await response.json()) as {
          state: string;
          continue_with?: Array<{
            action: string;
            redirect_browser_to?: string;
          }>;
        },
      }));
    await page.locator('button[name="method"][value="password"]').click();
    const update = await saved;
    expect(update.status).toBe(200);
    const updated = update.body;
    expect(updated.state).toBe('success');
    const redirect = updated.continue_with?.find(
      (item) => item.action === 'redirect_browser_to',
    )?.redirect_browser_to;
    if (redirect) {
      expect(await settingsNavigation).not.toBeNull();
      await expect(page).toHaveURL(redirect);
      await page.waitForLoadState();
    } else await expect(page.getByText(/saved|success/i).first()).toBeVisible();
    if (page.url() !== returnTo) await page.goto(returnTo);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('input[name="identifier"]')).toBeVisible();
    await login(page);
  });

  test('renders account settings and enrols a backend-configured authenticator', async ({
    page,
  }) => {
    await login(page);
    await page.goto(
      `${CONSOLE_URL}/auth/login?refresh=true&return_to=${encodeURIComponent(returnTo)}`,
    );
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await page.locator('input[name="password"]').fill(user.password);
    await submitMethod(page);
    await expect(page).toHaveURL(returnTo);
    await page.goto(`${CONSOLE_URL}/auth/settings`);
    await expect(page.locator('input[name="password"]')).toBeVisible();
    const flowId = new URL(page.url()).searchParams.get('flow');
    if (!flowId) throw new Error('Settings did not initialize a flow');
    totpSecret = await readTotpSecret(page, flowId);
    await waitForFreshTotpWindow();
    await page
      .locator('input[name="totp_code"]')
      .fill(generateTotpCode(totpSecret));
    await page.locator('button[name="method"][value="totp"]').click();
    await expect(
      page.getByRole('button', { name: 'Remove authenticator app' }),
    ).toBeVisible();
    await page.goto(`${CONSOLE_URL}/auth/logout`);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('input[name="identifier"]')).toBeVisible();
    await login(page);
    const response = await page.request.get(
      `${KRATOS_PUBLIC_URL}/sessions/whoami`,
    );
    expect(
      ((await response.json()) as { authenticator_assurance_level: string })
        .authenticator_assurance_level,
    ).toBe('aal2');
    await page.goto(`${CONSOLE_URL}/auth/settings`);
    const remove = page.getByRole('button', {
      name: 'Remove authenticator app',
    });
    await expect(remove).toBeVisible();
    if (process.env['AUTH_UI_VISUAL_TESTS'] === '1') {
      await expect(
        page.getByTestId('ory/screen/settings/group/totp'),
      ).toHaveScreenshot('settings-totp-enrolled.png', {
        animations: 'disabled',
      });
    }
    await remove.click();
    await expect(page.locator('input[name="totp_code"]')).toBeVisible();
  });

  test('completes OAuth consent, callback and confirmed RP logout through Console', async ({
    page,
  }) => {
    test.skip(
      process.env['AUTH_UI_OAUTH_TESTS'] !== '1',
      'Requires disposable Hydra admin access',
    );
    const publicUrl =
      process.env['HYDRA_PUBLIC_URL'] ?? 'http://localhost:4444';
    const admin = new OAuth2Api(
      new Configuration({
        basePath: process.env['HYDRA_ADMIN_URL'] ?? 'http://localhost:4445',
      }),
    );
    const id = `auth-ui-${randomUUID()}`;
    const callback = `${CONSOLE_URL}/auth/logout`;
    const signedOut = `${CONSOLE_URL}/auth/login`;
    await admin.createOAuth2Client({
      oAuth2Client: {
        client_id: id,
        client_name: 'Synthetic Console browser test',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'openid profile email',
        redirect_uris: [callback],
        post_logout_redirect_uris: [signedOut],
      },
    });
    try {
      // TOTP was removed by the preceding case.
      totpSecret = '';
      await login(page);
      const verifier = randomBytes(32).toString('base64url');
      const state = randomUUID();
      const auth = new URL('/oauth2/auth', publicUrl);
      auth.search = new URLSearchParams({
        client_id: id,
        response_type: 'code',
        redirect_uri: callback,
        scope: 'openid profile email',
        state,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256')
          .update(verifier)
          .digest('base64url'),
      }).toString();
      await page.goto(auth.href);
      // A new Hydra login challenge requires explicit authentication even
      // when a Kratos browser session already exists.
      await expect(page.locator('input[name="password"]')).toBeVisible();
      await page.locator('input[name="password"]').fill(user.password);
      await submitMethod(page);
      await expect(
        page.getByRole('button', { name: 'Allow', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Allow', exact: true }).click();
      await page.waitForURL(
        (url) =>
          url.pathname === '/auth/logout' && url.searchParams.has('code'),
        { timeout: 20_000 },
      );
      const result = new URL(page.url());
      expect(result.searchParams.get('state')).toBe(state);
      const code = result.searchParams.get('code');
      if (!code) throw new Error('OAuth callback did not return a code');
      // Token endpoint is an explicit raw-fetch exception in the E2E contract.
      const exchange = await fetch(new URL('/oauth2/token', publicUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: id,
          redirect_uri: callback,
          code,
          code_verifier: verifier,
        }),
      });
      expect(exchange.status).toBe(200);
      const tokens = (await exchange.json()) as { id_token?: string };
      if (!tokens.id_token)
        throw new Error('OAuth response did not include an identity token');
      const logoutState = randomUUID();
      const end = new URL('/oauth2/sessions/logout', publicUrl);
      end.search = new URLSearchParams({
        id_token_hint: tokens.id_token,
        post_logout_redirect_uri: signedOut,
        state: logoutState,
      }).toString();
      await page.goto(end.href);
      await page.waitForURL(
        (url) =>
          url.pathname === '/auth/logout' &&
          url.searchParams.has('logout_challenge'),
        { timeout: 20_000 },
      );
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page.locator('input[name="identifier"]')).toBeVisible();
      expect(new URL(page.url()).searchParams.get('state')).toBe(logoutState);
      expect(
        (
          await page.request.get(`${KRATOS_PUBLIC_URL}/sessions/whoami`)
        ).status(),
      ).toBe(401);
    } finally {
      await admin.deleteOAuth2Client({ id });
    }
  });
});
