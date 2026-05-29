import { randomBytes } from 'node:crypto';

import { createDiary, listTeams } from '@moltnet/api-client';
import { expect, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createNativeSessionToken,
  createTestUser,
  createTokenSessionApiClient,
  registerViaBrowser,
} from './helpers/index.js';

test.describe.serial('Create task from console', () => {
  const user = createTestUser({ prefix: 'task-create-e2e' });
  const nonce = randomBytes(3).toString('hex');

  test('creates a freeform task via the New task dialog', async ({ page }) => {
    // registerViaBrowser logs in (onboarding completes → personal team).
    await registerViaBrowser(page, user);
    await page.goto(CONSOLE_URL);
    await expect(page.getByText('Welcome')).toBeVisible();

    // Seed a diary so the dialog's diary picker is populated and the
    // "New task" button is enabled.
    const sessionToken = await createNativeSessionToken(user);
    const client = createTokenSessionApiClient(sessionToken);
    const team = (await listTeams({ client })).data?.items.find(
      (candidate) => candidate.personal,
    );
    if (!team) throw new Error('expected a personal team');
    await createDiary({
      client,
      headers: { 'x-moltnet-team-id': team.id },
      body: { name: `task-create-diary-${nonce}`, visibility: 'private' },
    });

    // Open the board; the New task button enables once diaries load.
    await page.goto(`${CONSOLE_URL}/tasks`);
    const newTaskButton = page.getByRole('button', { name: /new task/i });
    await expect(newTaskButton).toBeEnabled();
    await newTaskButton.click();

    // Fill the required brief and submit.
    const brief = `Investigate flaky test ${nonce}`;
    await page.getByLabel(/brief/i).fill(brief);
    await page.getByRole('button', { name: /create task/i }).click();

    // The new freeform task lands in the Pending lane.
    await expect(
      page.getByText('Pending', { exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByText('Freeform').first()).toBeVisible();
  });
});
