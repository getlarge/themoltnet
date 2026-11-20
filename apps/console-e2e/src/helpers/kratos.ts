import { Configuration, FrontendApi } from '@ory/client-fetch';
import { expect, type Page } from '@playwright/test';

import { CONSOLE_URL, KRATOS_PUBLIC_URL } from './env.js';
import { waitForVerificationCode } from './mailpit.js';
import type { TestUser } from './test-user.js';
import { generateTotpCode, waitForFreshTotpWindow } from './totp.js';

export async function submitKratosForm(page: Page): Promise<void> {
  await page
    .locator('form button[type="submit"][name="method"]')
    .first()
    .click();
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
  const passwordWasVisible = await passwordField
    .isVisible({ timeout: 1500 })
    .catch(() => false);
  if (passwordWasVisible) {
    await passwordField.fill(user.password);
  }

  await submitKratosForm(page);

  // Only look for a second credential step when the first form had none.
  // Re-reading the old password field immediately after clicking can submit
  // the same in-flight form twice with the client-rendered Console UI.
  if (!passwordWasVisible) {
    const passwordChoice = page.getByRole('button', {
      name: /^Password(?:\s|$)/,
    });
    await expect(passwordField.or(passwordChoice)).toBeVisible();
    if (await passwordChoice.isVisible()) await passwordChoice.click();
    await expect(passwordField).toBeVisible();
    await passwordField.fill(user.password);
    await submitKratosForm(page);
  }

  // Elements submits asynchronously. Navigating to login before the backend
  // finishes registration aborts that request and leaves no usable account.
  await expect(page).toHaveURL(
    (url) =>
      url.origin === new URL(CONSOLE_URL).origin &&
      url.pathname === '/auth/login',
  );
  await expect(page.locator('input[name="identifier"]')).toBeVisible();

  // Registration does NOT auto-login: the `session` hook was removed from
  // kratos.yaml/project.json so that the `after-login` webhook (which completes
  // human onboarding — links identity_id, creates the personal team) runs. The
  // real user flow is therefore register -> log in. Mirror it here so callers
  // end up authenticated (and onboarded), same as before the hook change.
  await loginViaBrowser(page, user, { returnTo });
}

export interface LoginOptions {
  /** Override post-login return URL. Defaults to CONSOLE_URL + '/'. */
  returnTo?: string;
  /**
   * ISO baseline used by the mailpit poller to ignore older verification
   * emails when falling back to the code flow. Defaults to the current time.
   */
  sinceIso?: string;
}

async function waitForLoginResult(page: Page, returnTo: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.url() === new URL(returnTo).href ||
        (await page.locator('input[name="totp_code"]').isVisible()),
    )
    .toBe(true);
  // A caller may navigate immediately. Finish the redirected document first
  // so that navigation cannot race the successful login's redirect.
  await page.waitForLoadState('domcontentloaded');
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
  const passwordChoice = page.getByRole('button', {
    name: /^Password(?:\s|$)/,
  });
  const codeField = page.locator('input[name="code"]');
  if (
    !(await passwordField.isVisible()) &&
    !(await passwordChoice.isVisible())
  ) {
    await submitKratosForm(page);
    await expect(passwordField.or(passwordChoice).or(codeField)).toBeVisible();
  }
  if (await passwordChoice.isVisible()) await passwordChoice.click();
  if (await passwordField.isVisible()) {
    await passwordField.fill(user.password);
    // Await the first-factor response before callers abandon the MFA screen.
    // A click alone does not wait for Elements' asynchronous SDK submission.
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/self-service/login',
      ),
      submitKratosForm(page),
    ]);
    await waitForLoginResult(page, returnTo);
    return;
  }

  const code = await waitForVerificationCode(user.email, { sinceIso });
  await codeField.fill(code);
  await submitKratosForm(page);
  await waitForLoginResult(page, returnTo);
}

interface KratosUiNode {
  group: string;
  attributes: {
    name?: string;
    value?: unknown;
    id?: string;
    text?: { text?: string; context?: { secret?: string } };
  };
}

interface KratosFlow {
  id: string;
  ui: { nodes: KratosUiNode[]; messages?: { text: string }[] };
}

function findNodeValue(flow: KratosFlow, name: string): string | undefined {
  const node = flow.ui.nodes.find((n) => n.attributes.name === name);
  return typeof node?.attributes.value === 'string'
    ? node.attributes.value
    : undefined;
}

/**
 * Reads a settings flow and its TOTP secret through the Kratos JSON API rather
 * than the Console UI: the secret only exists inside the flow payload, and
 * scraping it out of the rendered QR code would couple this to that UI's
 * markup.
 *
 * `page.request` shares the browser context's cookie jar, so the session and
 * CSRF cookies established by the login flow apply here.
 */
async function readSettingsFlow(
  page: Page,
  flowId: string,
): Promise<{ flow: KratosFlow; secret: string }> {
  const flowResponse = await page.request.get(
    `${KRATOS_PUBLIC_URL}/self-service/settings/flows?id=${flowId}`,
    { headers: { accept: 'application/json' } },
  );
  if (!flowResponse.ok()) {
    throw new Error(`Could not read settings flow: ${flowResponse.status()}`);
  }
  const flow = (await flowResponse.json()) as KratosFlow;

  const secretNode = flow.ui.nodes.find(
    (node) => node.attributes.id === 'totp_secret_key',
  );
  const secret =
    secretNode?.attributes.text?.context?.secret ??
    secretNode?.attributes.text?.text;
  if (!secret) {
    throw new Error(
      'Settings flow exposed no TOTP secret — is the totp method enabled in kratos.yaml?',
    );
  }
  return { flow, secret };
}

export async function readTotpSecret(
  page: Page,
  flowId: string,
): Promise<string> {
  return (await readSettingsFlow(page, flowId)).secret;
}

/** Enrols an authenticator app for the currently signed-in identity. */
export async function enrollTotp(page: Page): Promise<string> {
  await page.goto(`${KRATOS_PUBLIC_URL}/self-service/settings/browser`);
  const flowId = new URL(page.url()).searchParams.get('flow');
  if (!flowId) {
    throw new Error(`Settings flow did not start; landed on ${page.url()}`);
  }
  const { flow, secret } = await readSettingsFlow(page, flowId);
  const csrfToken = findNodeValue(flow, 'csrf_token');
  await waitForFreshTotpWindow();

  const submission = await page.request.post(
    `${KRATOS_PUBLIC_URL}/self-service/settings?flow=${flowId}`,
    {
      headers: { accept: 'application/json' },
      data: {
        csrf_token: csrfToken,
        method: 'totp',
        totp_code: generateTotpCode(secret),
      },
    },
  );
  if (!submission.ok()) {
    throw new Error(
      `TOTP enrolment failed (${submission.status()}): ${await submission.text()}`,
    );
  }

  // Returned rather than re-read later: Kratos only exposes the secret while
  // the credential is being set up.
  return secret;
}

/**
 * Ends the browser session through the Kratos logout flow.
 *
 * No-op when there is nothing to end. Playwright hands every test its own
 * browser context — `test.describe.serial` orders tests, it does not share
 * cookies between them — so a suite that logs out before logging in usually
 * starts from an empty jar. Kratos answers that with 401 `session_inactive`
 * and no `logout_url`, and the caller's postcondition ("signed out") already
 * holds. Any other non-2xx is a real failure and is surfaced.
 */
export async function logoutViaBrowser(page: Page): Promise<void> {
  const response = await page.request.get(
    `${KRATOS_PUBLIC_URL}/self-service/logout/browser`,
    { headers: { accept: 'application/json' } },
  );
  if (response.status() === 401) {
    return;
  }
  if (!response.ok()) {
    throw new Error(
      `Could not start logout flow (${response.status()}): ${await response.text()}`,
    );
  }
  const { logout_url: logoutUrl } = (await response.json()) as {
    logout_url?: string;
  };
  if (!logoutUrl) {
    throw new Error('Logout flow returned no logout_url');
  }
  await page.goto(logoutUrl);
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
