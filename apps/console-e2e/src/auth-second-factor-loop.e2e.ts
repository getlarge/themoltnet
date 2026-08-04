/**
 * Regression: infinite redirect loop when a second factor is
 * pending.
 *
 * Reported from a phone: signing in with the GitHub OIDC provider, abandoning
 * the two-factor step, then navigating back to the console. The session cookie
 * exists but sits at aal1, so:
 *
 *   1. `/sessions/whoami` answers 403 (session_aal2_required)
 *   2. the console read that as "logged out" and sent the browser to a plain
 *      login flow
 *   3. Kratos evaluated the aal1 session against a requested aal1, concluded
 *      the user was already logged in, and 302'd to `return_to`
 *   4. back to step 1, forever
 *
 * Each bounce also pushed a history entry, so Back walked backwards *through*
 * the loop. On mobile, with no way to clear cookies for a single domain, that
 * left no escape.
 *
 * The provider is not the trigger — any aal1 session is — so this drives the
 * same state with password + TOTP, which needs no external identity provider.
 */

import { expect, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createTestUser,
  enrollTotp,
  expectConsoleOverview,
  generateTotpCode,
  KRATOS_PUBLIC_URL,
  loginViaBrowser,
  logoutViaBrowser,
  registerViaBrowser,
  submitKratosForm,
  waitForFreshTotpWindow,
} from './helpers/index.js';

/**
 * How long we let the browser settle before deciding it is not looping.
 *
 * Every hop is local, so an unfixed console racks up dozens of console loads
 * in this window; a fixed one loads it at most twice (the initial navigation
 * plus one redirect away).
 */
const SETTLE_MS = 5_000;
const MAX_CONSOLE_LOADS = 2;

test.describe.serial('console auth with a pending second factor', () => {
  const user = createTestUser({ prefix: 'console-2fa' });
  // Kratos only exposes the TOTP secret during enrolment, so the first test
  // hands it to the rest of the suite.
  let totpSecret = '';

  test('enrols an authenticator app', async ({ page }) => {
    await registerViaBrowser(page, user);
    await expectConsoleOverview(page);

    totpSecret = await enrollTotp(page);
    expect(totpSecret).not.toHaveLength(0);

    // Completing TOTP setup upgrades the current session to aal2, so the
    // console still works — the loop needs a *fresh* aal1 session.
    await page.goto(`${CONSOLE_URL}/`);
    await expectConsoleOverview(page);
  });

  test('does not loop when the user abandons the second-factor step', async ({
    page,
  }) => {
    await logoutViaBrowser(page);

    // First factor only. Kratos issues the session cookie here and then asks
    // for the second factor — this is the state the reporter was in.
    await loginViaBrowser(page, user);

    const consoleLoads: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url().startsWith(CONSOLE_URL)) {
        consoleLoads.push(frame.url());
      }
    });

    // "I tried to go back on the previous page": walk straight into the
    // console instead of finishing the 2FA form.
    await page.goto(`${CONSOLE_URL}/tasks`);
    await page.waitForTimeout(SETTLE_MS);

    expect(
      consoleLoads.length,
      `console reloaded ${consoleLoads.length} times — redirect loop`,
    ).toBeLessThanOrEqual(MAX_CONSOLE_LOADS);

    // Landed on the second-factor form, not back on the console.
    await expect(page.locator('input[name="totp_code"]')).toBeVisible();
    expect(page.url()).not.toContain(CONSOLE_URL);
  });

  test('sends the second-factor challenge to an aal2 login flow', async ({
    page,
  }) => {
    await logoutViaBrowser(page);
    await loginViaBrowser(page, user);

    const kratosLoginRequests: string[] = [];
    page.on('request', (request) => {
      if (
        request.isNavigationRequest() &&
        request.url().startsWith(`${KRATOS_PUBLIC_URL}/self-service/login`)
      ) {
        kratosLoginRequests.push(request.url());
      }
    });

    await page.goto(`${CONSOLE_URL}/`);
    await expect(page.locator('input[name="totp_code"]')).toBeVisible();

    // Without aal=aal2 Kratos treats the existing aal1 session as sufficient
    // and bounces back to return_to. This assertion is the loop's root cause.
    expect(kratosLoginRequests.some((url) => url.includes('aal=aal2'))).toBe(
      true,
    );
  });

  test('completing the second factor lands back on the requested page', async ({
    page,
  }) => {
    await logoutViaBrowser(page);
    await loginViaBrowser(page, user);

    await page.goto(`${CONSOLE_URL}/tasks`);
    const totpInput = page.locator('input[name="totp_code"]');
    await expect(totpInput).toBeVisible();

    await waitForFreshTotpWindow();
    await totpInput.fill(generateTotpCode(totpSecret));
    await submitKratosForm(page);

    // return_to must survive the aal2 hop, otherwise the deep link is lost.
    await expect(page).toHaveURL(`${CONSOLE_URL}/tasks`);
  });
});
