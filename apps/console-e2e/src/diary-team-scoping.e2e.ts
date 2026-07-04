import { randomBytes } from 'node:crypto';

import { createDiary, createTeam } from '@moltnet/api-client';
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

async function createDiaryViaApi(
  cookieHeader: string,
  teamId: string,
  name: string,
): Promise<string> {
  const client = createCookieSessionApiClient(cookieHeader);
  const response = await createDiary({
    client,
    headers: { 'x-moltnet-team-id': teamId },
    body: { name, visibility: 'moltnet' },
  });
  const status = response.response.status;
  expect(response.response.ok || status === 201 || status === 202).toBe(true);
  if (!response.data) {
    throw new Error(
      `Failed to create diary "${name}" in team ${teamId}: ${status} ${JSON.stringify(response.error)}`,
    );
  }
  return response.data.id;
}

test.describe.serial('Diary team scoping', () => {
  const user = createTestUser({ prefix: 'diary-scope' });
  let cookieHeader: string;
  let alphaTeamId: string;
  let betaTeamId: string;
  const alphaDiaryName = `alpha-diary-${randomBytes(3).toString('hex')}`;
  const betaDiaryName = `beta-diary-${randomBytes(3).toString('hex')}`;

  test('register user, create two teams, create a diary in each', async ({
    page,
  }) => {
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

    alphaTeamId = await createTeamViaApi(cookieHeader, 'alpha-scoping');
    betaTeamId = await createTeamViaApi(cookieHeader, 'beta-scoping');
    await createDiaryViaApi(cookieHeader, alphaTeamId, alphaDiaryName);
    await createDiaryViaApi(cookieHeader, betaTeamId, betaDiaryName);
  });

  test("diaries page shows only the selected team's diary", async ({
    page,
  }) => {
    await loginViaBrowser(page, user);

    const teamSelect = page.locator('select[aria-label="Select team"]');
    await expect(teamSelect).toBeVisible();

    await teamSelect.selectOption({ label: 'alpha-scoping' });
    await page.goto(`${CONSOLE_URL}/diaries`);
    await expect(page.getByText(alphaDiaryName)).toBeVisible();
    await expect(page.getByText(betaDiaryName)).toHaveCount(0);

    await teamSelect.selectOption({ label: 'beta-scoping' });
    await expect(page.getByText(betaDiaryName)).toBeVisible();
    await expect(page.getByText(alphaDiaryName)).toHaveCount(0);
  });

  test('personal team scope hides team diaries', async ({ page }) => {
    await loginViaBrowser(page, user);

    const teamSelect = page.locator('select[aria-label="Select team"]');
    await expect(teamSelect).toBeVisible();

    const optionTexts = await teamSelect.locator('option').allTextContents();
    const personalLabel = optionTexts.find(
      (t) => !t.includes('alpha-scoping') && !t.includes('beta-scoping'),
    );
    if (!personalLabel) throw new Error('No personal team option found');

    await teamSelect.selectOption({ label: personalLabel });
    await page.goto(`${CONSOLE_URL}/diaries`);

    await expect(page.getByText(alphaDiaryName)).toHaveCount(0);
    await expect(page.getByText(betaDiaryName)).toHaveCount(0);
  });
});
