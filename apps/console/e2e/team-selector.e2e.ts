import { createTeam } from '@moltnet/api-client';
import { expect, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createCookieSessionApiClient,
  createTestUser,
  getSessionCookie,
  loginViaBrowser,
  registerViaBrowser,
  submitKratosForm,
  waitForVerificationCode,
} from './helpers/index.js';

async function createTeamViaApi(
  cookieHeader: string,
  name: string,
): Promise<string> {
  const client = createCookieSessionApiClient(cookieHeader);
  const response = await createTeam({ client, body: { name } });
  const status = response.response.status;
  expect(response.response.ok || status === 201 || status === 202).toBe(true);
  if (!response.data) {
    throw new Error(
      `Failed to create team "${name}": ${status} ${JSON.stringify(response.error)}`,
    );
  }
  return response.data.id;
}

test.describe.serial('Team selector', () => {
  const user = createTestUser({ prefix: 'team-e2e' });
  const alphaTeamName = 'alpha-team';
  const betaTeamName = 'beta-team';
  let cookieHeader: string;

  test('register and create two teams', async ({ page }) => {
    await registerViaBrowser(page, user);

    const codeInput = page.locator('input[name="code"]');
    if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const code = await waitForVerificationCode(user.email);
      await codeInput.fill(code);
      await submitKratosForm(page);
    }

    await page.goto(`${CONSOLE_URL}/`);
    await expect(page.getByText('Welcome')).toBeVisible();
    cookieHeader = await getSessionCookie(page);

    await createTeamViaApi(cookieHeader, alphaTeamName);
    await createTeamViaApi(cookieHeader, betaTeamName);
  });

  test('sidebar shows team selector dropdown with multiple teams', async ({
    page,
  }) => {
    await loginViaBrowser(page, user);

    await expect(page).toHaveURL(/localhost:5174/);
    await expect(page.getByText('Welcome')).toBeVisible();

    const teamSelect = page.locator('select[aria-label="Select team"]');
    await expect(teamSelect).toBeVisible();

    const options = teamSelect.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(3);

    const optionTexts = await options.allTextContents();
    expect(optionTexts.some((t) => t.includes(alphaTeamName))).toBe(true);
    expect(optionTexts.some((t) => t.includes(betaTeamName))).toBe(true);
  });

  test('switching team updates the overview', async ({ page }) => {
    await loginViaBrowser(page, user);

    await expect(page).toHaveURL(/localhost:5174/);
    await expect(page.getByText('Welcome')).toBeVisible();

    const teamSelect = page.locator('select[aria-label="Select team"]');
    await teamSelect.selectOption({ label: alphaTeamName });
    await expect(page.getByText(`Team: ${alphaTeamName}`)).toBeVisible();

    await teamSelect.selectOption({ label: betaTeamName });
    await expect(page.getByText(`Team: ${betaTeamName}`)).toBeVisible();
  });

  test('team selection persists across page reload', async ({ page }) => {
    await loginViaBrowser(page, user);

    await expect(page).toHaveURL(/localhost:5174/);

    const teamSelect = page.locator('select[aria-label="Select team"]');
    await expect(teamSelect).toBeVisible();
    await teamSelect.selectOption({ label: betaTeamName });
    await expect(page.getByText(`Team: ${betaTeamName}`)).toBeVisible();

    await page.reload();
    await expect(page.getByText('Welcome')).toBeVisible();

    await expect(page.getByText(`Team: ${betaTeamName}`)).toBeVisible();
  });
});
