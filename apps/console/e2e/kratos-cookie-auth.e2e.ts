import { listDiaries } from '@moltnet/api-client';
import { expect, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createCookieSessionApiClient,
  createTestUser,
  getSessionCookie,
  loginViaBrowser,
  registerViaBrowser,
  submitKratosForm,
  waitForVerificationData,
} from './helpers/index.js';

test.describe.serial('Kratos browser cookie auth', () => {
  const user = createTestUser({ prefix: 'console-e2e' });

  test('registration flow sends verification email and establishes a session', async ({
    page,
  }) => {
    await registerViaBrowser(page, user);

    const verification = await waitForVerificationData(user.email);

    const codeInput = page.locator('input[name="code"]');
    if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      if (!verification.code) {
        throw new Error('Registration code flow did not produce a code');
      }
      await codeInput.fill(verification.code);
      await submitKratosForm(page);
    } else if (verification.link) {
      await page.goto(verification.link);
    }

    await page.goto(`${CONSOLE_URL}/`);
    await expect(page.getByText('Welcome')).toBeVisible();
    await getSessionCookie(page);
  });

  test('login flow sets session cookie and redirects to console', async ({
    page,
  }) => {
    await loginViaBrowser(page, user);

    await expect(page).toHaveURL(/localhost:5174\//);
    await expect(page.getByText('Welcome')).toBeVisible();
    await getSessionCookie(page);
  });

  test('authenticated REST API call succeeds using cookie only', async ({
    page,
  }) => {
    await loginViaBrowser(page, user);
    const cookieHeader = await getSessionCookie(page);

    const client = createCookieSessionApiClient(cookieHeader);
    const response = await listDiaries({ client });

    expect(response.response.ok).toBe(true);
    expect(Array.isArray(response.data?.items)).toBe(true);
  });

  test('logout invalidates the session', async ({ page }) => {
    await loginViaBrowser(page, user);
    const cookieHeader = await getSessionCookie(page);

    await page
      .getByRole('button', { name: 'Logout' })
      .click({ noWaitAfter: true });
    await expect(async () => {
      const cookies = await page.context().cookies();
      const activeSession = cookies.find(
        (cookie) =>
          cookie.name === 'ory_kratos_session' ||
          cookie.name.startsWith('ory_session_'),
      );
      expect(activeSession).toBeUndefined();
    }).toPass({ timeout: 15_000 });

    const client = createCookieSessionApiClient(cookieHeader);
    const response = await listDiaries({ client });

    expect(response.response.status).toBe(401);
  });
});
