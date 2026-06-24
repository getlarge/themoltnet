import { randomBytes } from 'node:crypto';

import { listTeams } from '@moltnet/api-client';
import { expect, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createNativeSessionToken,
  createTestUser,
  createTokenSessionApiClient,
  loginViaBrowser,
  registerViaBrowser,
} from './helpers/index.js';

test.describe.serial('Runtime profiles console', () => {
  const user = createTestUser({ prefix: 'runtime-profiles-e2e' });
  const nonce = randomBytes(3).toString('hex');
  const profileName = `console-profile-${nonce}`;
  const secondProfileName = `console-profile-second-${nonce}`;
  const editedDescription = `Updated profile description ${nonce}`;
  let sessionToken: string;
  let teamId: string;

  test('registers a human and resolves the personal team', async ({ page }) => {
    await registerViaBrowser(page, user);
    await page.goto(CONSOLE_URL);
    await expect(page.getByText('Welcome')).toBeVisible();

    sessionToken = await createNativeSessionToken(user);
    const client = createTokenSessionApiClient(sessionToken);
    const team = (await listTeams({ client })).data?.items.find(
      (candidate) => candidate.personal,
    );
    if (!team) throw new Error('expected a personal team');
    teamId = team.id;
  });

  test('creates, edits, and deletes a runtime profile', async ({ page }) => {
    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/profiles`);

    await expect(
      page.getByRole('heading', { name: /runtime profiles/i }),
    ).toBeVisible();
    await page.getByRole('button', { name: /new profile/i }).click();
    await page.getByLabel(/^name$/i).fill(profileName);
    await page.getByLabel(/^provider$/i).fill('anthropic');
    await page.getByLabel(/^model$/i).fill('claude-sonnet-4-5');
    await page.getByLabel(/sandbox json/i).fill('{}');
    await page.getByRole('button', { name: /create profile/i }).click();

    await expect(
      page.getByRole('button', { name: new RegExp(profileName) }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: new RegExp(`${profileName}.*anthropic/claude-sonnet-4-5`),
      }),
    ).toBeVisible();

    await page.getByRole('button', { name: /new profile/i }).click();
    await expect(page.getByLabel(/^name$/i)).toHaveValue('');
    await expect(
      page.getByRole('button', { name: /create profile/i }),
    ).toBeVisible();
    await page.getByLabel(/^name$/i).fill(secondProfileName);
    await page.getByLabel(/^provider$/i).fill('anthropic');
    await page.getByLabel(/^model$/i).fill('claude-sonnet-4-5');
    await page.getByLabel(/sandbox json/i).fill('{}');
    await page.getByRole('button', { name: /create profile/i }).click();

    await expect(
      page.getByRole('button', { name: new RegExp(profileName) }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(secondProfileName) }),
    ).toBeVisible();

    await page.getByLabel(/description/i).fill(editedDescription);
    await page.getByRole('button', { name: /save profile/i }).click();
    await expect(page.getByLabel(/description/i)).toHaveValue(
      editedDescription,
    );

    await page.getByRole('button', { name: /delete profile/i }).click();
    await expect(page.getByText(secondProfileName)).toHaveCount(0);
    await page.getByRole('button', { name: new RegExp(profileName) }).click();
    await page.getByRole('button', { name: /delete profile/i }).click();
    await expect(page.getByText(profileName)).toHaveCount(0);
    await expect(page.getByText(/no runtime profiles yet/i)).toBeVisible();

    expect(teamId).toBeTruthy();
  });
});
