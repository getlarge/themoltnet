import { expect, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createTestUser,
  expectConsoleOverview,
  loginViaBrowser,
  registerViaBrowser,
  submitKratosForm,
  waitForVerificationCode,
} from './helpers/index.js';

const SIGNER_ORIGIN = 'http://127.0.0.1:17373';

test.describe.serial('Signing surface', () => {
  const user = createTestUser({ prefix: 'signing-e2e' });

  test('registers an authenticated Console human', async ({ page }) => {
    await registerViaBrowser(page, user);

    const codeInput = page.locator('input[name="code"]');
    if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await codeInput.fill(await waitForVerificationCode(user.email));
      await submitKratosForm(page);
    }

    await page.goto(`${CONSOLE_URL}/`);
    await expectConsoleOverview(page);
  });

  test('opens the team signing surface without forwarding browser auth to loopback', async ({
    page,
  }) => {
    const loopbackRequests: {
      headers: Record<string, string>;
      postData: string | null;
    }[] = [];
    await page.route(`${SIGNER_ORIGIN}/**`, async (route) => {
      const request = route.request();
      loopbackRequests.push({
        headers: request.headers(),
        postData: request.postData(),
      });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': new URL(CONSOLE_URL).origin,
          vary: 'Origin',
        },
        body: JSON.stringify({
          version: 1,
          token: 'browser-e2e-process-capability',
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      });
    });

    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/signing`);

    await expect(
      page.getByRole('heading', { name: 'Signing', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Companion connected')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Signable requests' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Signing credentials' }),
    ).toBeVisible();

    expect(loopbackRequests).toHaveLength(1);
    const [{ headers, postData }] = loopbackRequests;
    expect(headers['authorization']).toBeUndefined();
    expect(headers['cookie']).toBeUndefined();
    expect(headers['x-moltnet-session-token']).toBeUndefined();
    expect(postData ?? '').not.toMatch(
      /access.?token|refresh.?token|session.?token|authorization|cookie/iu,
    );
  });

  test('connects to the real host-side signing companion', async ({ page }) => {
    test.skip(
      process.env['MOLTNET_SIGNER_E2E'] !== '1',
      'Set MOLTNET_SIGNER_E2E=1 and start @themoltnet/signer on port 17373.',
    );

    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/signing`);

    await expect(
      page.getByRole('heading', { name: 'Signing', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Companion connected')).toBeVisible();
    await expect(page.getByText('Companion unavailable')).toBeHidden();
  });
});
