import { expect, test } from '@playwright/test';

import { CONSOLE_URL, KRATOS_PUBLIC_URL } from './helpers/env.js';

test('returns through a real OIDC callback using a synthetic provider', async ({
  page,
}) => {
  test.skip(
    process.env['AUTH_UI_MOCK_OIDC_TESTS'] !== '1',
    'Requires the disposable OIDC provider fixture',
  );
  const mock = process.env['OIDC_MOCK_BROWSER_URL'];
  if (!mock) throw new Error('OIDC_MOCK_BROWSER_URL is required');
  expect((await page.request.post(`${mock}/test/reset`)).status()).toBe(200);
  const returnTo = `${CONSOLE_URL}/auth/logout`;
  const start = `${CONSOLE_URL}/auth/login?return_to=${encodeURIComponent(returnTo)}`;
  await page.goto(start);
  await page
    .locator('button[name="provider"][value="acceptance-mock"]')
    .click();
  await expect(
    page.getByRole('heading', { name: 'Mock identity provider' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Continue as synthetic user' })
    .click();
  // An explicit return_to is preserved across the first registration callback.
  await expect(page).toHaveURL(returnTo);
  expect(
    (await page.request.get(`${KRATOS_PUBLIC_URL}/sessions/whoami`)).status(),
  ).toBe(401);
  await page.goto(start);
  await page
    .locator('button[name="provider"][value="acceptance-mock"]')
    .click();
  await page
    .getByRole('button', { name: 'Continue as synthetic user' })
    .click();
  await expect(page).toHaveURL(returnTo);
  const response = await page.request.get(
    `${KRATOS_PUBLIC_URL}/sessions/whoami`,
  );
  expect(response.status()).toBe(200);
  const session = (await response.json()) as {
    identity: { traits: { email: string; username: string } };
    authentication_methods: Array<{ method: string }>;
  };
  expect(session.identity.traits.email).toMatch(
    /^mock-oidc-[a-f0-9]+@example\.com$/,
  );
  expect(session.identity.traits.username).toMatch(/^mock_oidc_[a-f0-9]+$/);
  expect(
    session.authentication_methods.some((item) => item.method === 'oidc'),
  ).toBe(true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('input[name="identifier"]')).toBeVisible();
  expect(
    (await page.request.get(`${KRATOS_PUBLIC_URL}/sessions/whoami`)).status(),
  ).toBe(401);
});
