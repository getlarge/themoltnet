import {
  Configuration,
  FrontendApi,
  type SettingsFlow,
} from '@ory/client-fetch';
import { expect, type Page, test } from '@playwright/test';

import { CONSOLE_URL, KRATOS_PUBLIC_URL } from './helpers/env.js';
import { submitKratosForm as submitMethod } from './helpers/kratos.js';
import { waitForVerificationCode } from './helpers/mailslurper.js';
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

  test.beforeEach(async ({ page }) => {
    // Test-only runtime injection permits the exact same built artifact to run
    // against another backend without rebuilding or changing frontend policy.
    if (process.env['AUTH_UI_INJECT_CONFIG'] === '1') {
      await page.route('**/config.js', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `window.__MOLTNET_CONFIG__=${JSON.stringify({
            kratosUrl: KRATOS_PUBLIC_URL,
            consoleUrl: CONSOLE_URL,
            apiBaseUrl: process.env['REST_API_URL'] ?? 'http://localhost:8080',
          })}`,
        }),
      );
    }
  });

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
    test.skip(
      process.env['AUTH_UI_MAIL_TESTS'] !== '1',
      'Requires a synthetic mailbox fixture',
    );
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
    // Share the browser cookie jar with the official SDK, without printing
    // session cookies or enrolment secrets in test diagnostics.
    const sdk = new FrontendApi(
      new Configuration({
        basePath: KRATOS_PUBLIC_URL,
        fetchApi: async (input, init) => {
          const response = await page.request.fetch(String(input), {
            method: init?.method,
            headers: init?.headers as Record<string, string>,
          });
          return new Response(new Uint8Array(await response.body()), {
            status: response.status(),
            headers: response.headers(),
          });
        },
      }),
    );
    const flow: SettingsFlow = await sdk.getSettingsFlow({ id: flowId });
    const node = flow.ui.nodes.find(
      (item) =>
        item.attributes.node_type === 'text' &&
        item.attributes.id === 'totp_secret_key',
    );
    if (node?.attributes.node_type !== 'text')
      throw new Error('Synthetic fixture must enable TOTP');
    totpSecret = String(
      (node.attributes.text.context as { secret?: string } | undefined)
        ?.secret ?? node.attributes.text.text,
    );
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
});
