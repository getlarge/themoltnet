import { Configuration, FrontendApi } from '@ory/client-fetch';
import type { Page } from '@playwright/test';

import { CONSOLE_URL, KRATOS_PUBLIC_URL } from './env.js';
import { waitForVerificationCode } from './mailslurper.js';
import type { TestUser } from './test-user.js';

export async function submitKratosForm(page: Page): Promise<void> {
  await page.locator('form button[type="submit"]').first().click();
}

export interface RegisterOptions {
  /**
   * Override the post-registration return URL. Defaults to CONSOLE_URL + '/'.
   */
  returnTo?: string;
}

export async function registerViaBrowser(
  page: Page,
  user: TestUser,
  { returnTo = `${CONSOLE_URL}/` }: RegisterOptions = {},
): Promise<void> {
  await page.goto(
    `${KRATOS_PUBLIC_URL}/self-service/registration/browser?return_to=${encodeURIComponent(
      returnTo,
    )}`,
  );

  await page.locator('input[name="traits.email"]').fill(user.email);
  await page.locator('input[name="traits.username"]').fill(user.username);

  const passwordField = page.locator('input[name="password"]');
  if (await passwordField.isVisible({ timeout: 1500 }).catch(() => false)) {
    await passwordField.fill(user.password);
  }

  await submitKratosForm(page);

  // Kratos may present registration in two steps:
  // 1) traits (email/username), 2) credential selection (password/code).
  const followupPasswordField = page.locator('input[name="password"]');
  if (
    await followupPasswordField.isVisible({ timeout: 3000 }).catch(() => false)
  ) {
    await followupPasswordField.fill(user.password);
    await submitKratosForm(page);
  }
}

export interface LoginOptions {
  /** Override post-login return URL. Defaults to CONSOLE_URL + '/'. */
  returnTo?: string;
  /**
   * ISO baseline used by the mailslurper poller to ignore older verification
   * emails when falling back to the code flow. Defaults to the current time.
   */
  sinceIso?: string;
}

export async function loginViaBrowser(
  page: Page,
  user: TestUser,
  {
    returnTo = `${CONSOLE_URL}/`,
    sinceIso = new Date().toISOString(),
  }: LoginOptions = {},
): Promise<void> {
  await page.goto(
    `${KRATOS_PUBLIC_URL}/self-service/login/browser?return_to=${encodeURIComponent(
      returnTo,
    )}`,
  );

  await page.locator('input[name="identifier"]').fill(user.email);

  const passwordField = page.locator('input[name="password"]');
  if (await passwordField.isVisible({ timeout: 1500 }).catch(() => false)) {
    await passwordField.fill(user.password);
    await submitKratosForm(page);
    return;
  }

  await submitKratosForm(page);
  const code = await waitForVerificationCode(user.email, { sinceIso });
  await page.locator('input[name="code"]').fill(code);
  await submitKratosForm(page);
}

export async function getSessionCookie(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find(
    (cookie) =>
      cookie.name === 'ory_kratos_session' ||
      cookie.name.startsWith('ory_session_'),
  );
  if (!sessionCookie) {
    throw new Error('Kratos session cookie not found');
  }
  return `${sessionCookie.name}=${sessionCookie.value}`;
}

export async function createNativeSessionToken(
  user: TestUser,
): Promise<string> {
  const kratos = new FrontendApi(
    new Configuration({ basePath: KRATOS_PUBLIC_URL }),
  );
  const loginFlow = await kratos.createNativeLoginFlow();
  const loginResult = await kratos.updateLoginFlow({
    flow: loginFlow.id,
    updateLoginFlowBody: {
      method: 'password',
      identifier: user.email,
      password: user.password,
    },
  });

  if (!loginResult.session_token) {
    throw new Error('Native login did not return a session token');
  }

  return loginResult.session_token;
}
