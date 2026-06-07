import { randomBytes } from 'node:crypto';

import { createDiary, listTasks, listTeams } from '@moltnet/api-client';
import { expect, type Page, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createNativeSessionToken,
  createTestUser,
  createTokenSessionApiClient,
  loginViaBrowser,
  registerViaBrowser,
} from './helpers/index.js';

test.describe.serial('Create task from console', () => {
  const user = createTestUser({ prefix: 'task-create-e2e' });
  const nonce = randomBytes(3).toString('hex');
  let teamId: string;
  let sessionToken: string;

  /**
   * Log in (each serial test gets a fresh browser context, so the session from
   * the register step doesn't carry over), open the board, and open the New
   * task dialog. Assumes a diary already exists.
   */
  async function openCreateDialog(page: Page) {
    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/tasks`);
    const newTaskButton = page.getByRole('button', { name: /new task/i });
    await expect(newTaskButton).toBeEnabled();
    await newTaskButton.click();
    await expect(
      page.getByRole('button', { name: /create task/i }),
    ).toBeVisible();
  }

  test('registers and seeds a diary', async ({ page }) => {
    // registerViaBrowser logs in (onboarding completes → personal team).
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
    await createDiary({
      client,
      headers: { 'x-moltnet-team-id': teamId },
      body: { name: `task-create-diary-${nonce}`, visibility: 'private' },
    });
  });

  test('creates a freeform task via the New task dialog', async ({ page }) => {
    await openCreateDialog(page);

    const brief = `Investigate flaky test ${nonce}`;
    await page.getByLabel(/brief/i).fill(brief);
    await page.getByRole('button', { name: /create task/i }).click();

    // The new freeform task lands in the Pending lane.
    await expect(
      page.getByText('Pending', { exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByText('Freeform').first()).toBeVisible();
  });

  test('disables submit until a brief is entered', async ({ page }) => {
    await openCreateDialog(page);

    const submit = page.getByRole('button', { name: /create task/i });
    await expect(submit).toBeDisabled();
    await page.getByLabel(/brief/i).fill(`Validate gate ${nonce}`);
    await expect(submit).toBeEnabled();
  });

  test('cancel closes the dialog without creating a task', async ({ page }) => {
    const client = createTokenSessionApiClient(sessionToken);
    const before = (await listTasks({ client, query: { teamId } })).data?.items
      .length;

    await openCreateDialog(page);
    await page.getByLabel(/brief/i).fill(`Should not be created ${nonce}`);
    await page.getByRole('button', { name: /^cancel$/i }).click();

    // Dialog dismissed; no new task created.
    await expect(
      page.getByRole('button', { name: /create task/i }),
    ).toBeHidden();
    const after = (await listTasks({ client, query: { teamId } })).data?.items
      .length;
    expect(after).toBe(before);
  });

  test('persists title and expected output', async ({ page }) => {
    await openCreateDialog(page);

    const title = `Titled task ${nonce}`;
    await page.getByLabel(/^brief/i).fill('Body of the titled task.');
    await page.getByLabel(/title/i).fill(title);
    await page.getByLabel(/expected output/i).fill('A short written summary.');
    await page.getByRole('button', { name: /create task/i }).click();

    // Verify via the API that title persisted as task metadata while
    // expectedOutput stayed in the freeform input.
    const client = createTokenSessionApiClient(sessionToken);
    await expect
      .poll(async () => {
        const items =
          (await listTasks({ client, query: { teamId } })).data?.items ?? [];
        return items.some(
          (t) =>
            typeof t.input === 'object' &&
            t.input !== null &&
            t.title === title &&
            (t.input as Record<string, unknown>).expectedOutput ===
              'A short written summary.',
        );
      })
      .toBe(true);
  });

  test('creates a task that depends on a prerequisite', async ({ page }) => {
    await openCreateDialog(page);

    await page.getByLabel(/^brief/i).fill(`Runs after a prerequisite ${nonce}`);
    await page
      .getByLabel(/search prerequisite tasks/i)
      .fill(`Titled task ${nonce}`);
    const prerequisiteOptions = page.locator('#depends-on-task-options');
    const prerequisite = prerequisiteOptions
      .getByRole('option', { name: new RegExp(`Titled task ${nonce}`) })
      .first();
    await expect(prerequisite).toBeVisible();
    await prerequisite.click();
    await expect(page.getByLabel(/^prerequisite task$/i)).toBeVisible();

    await page.getByRole('button', { name: /create task/i }).click();

    // Task created with a claimCondition: it should NOT auto-run. Assert it was
    // created and is in a pre-active lane (Pending — waiting/queued).
    const client = createTokenSessionApiClient(sessionToken);
    await expect
      .poll(async () => {
        const items =
          (await listTasks({ client, query: { teamId } })).data?.items ?? [];
        return items.some(
          (t) =>
            typeof t.input === 'object' &&
            t.input !== null &&
            (t.input as Record<string, unknown>).brief ===
              `Runs after a prerequisite ${nonce}` &&
            t.claimCondition !== null &&
            t.claimCondition !== undefined,
        );
      })
      .toBe(true);
  });

  test('creates a task with authored success criteria', async ({ page }) => {
    await openCreateDialog(page);
    await page.getByLabel(/^brief/i).fill(`Rubric task ${nonce}`);

    // Reveal the success-criteria editor and author one rubric criterion plus
    // required evidence.
    await page.getByRole('button', { name: /success criteria/i }).click();
    await page.getByRole('button', { name: /add criterion/i }).click();
    await page.getByLabel(/rubric id/i).fill('console-e2e-rubric');
    await page.getByLabel(/minimum acceptable score/i).fill('80');
    await page.getByLabel(/criterion name/i).fill('implementation_quality');
    await page.getByLabel(/weight/i).fill('100');
    await page
      .getByLabel(/criterion description/i)
      .fill('Pass when the task is implemented and verified.');
    await page.getByLabel(/require pr url/i).check();
    await page.getByLabel(/require diary entry/i).check();

    await page.getByRole('button', { name: /create task/i }).click();

    // The assembled successCriteria must pass server validation and persist on
    // the task input.
    const client = createTokenSessionApiClient(sessionToken);
    await expect
      .poll(async () => {
        const items =
          (await listTasks({ client, query: { teamId } })).data?.items ?? [];
        const task = items.find(
          (t) =>
            typeof t.input === 'object' &&
            t.input !== null &&
            (t.input as Record<string, unknown>).brief ===
              `Rubric task ${nonce}`,
        );
        const criteria = (task?.input as Record<string, unknown> | undefined)
          ?.successCriteria as
          | {
              assertions?: unknown[];
              minComposite?: number;
              rubric?: { criteria?: unknown[]; rubricId?: string };
              sideEffects?: { diaryEntryRequired?: boolean };
            }
          | undefined;
        return {
          assertions: Array.isArray(criteria?.assertions)
            ? criteria.assertions.length
            : 0,
          diaryEntryRequired:
            criteria?.sideEffects?.diaryEntryRequired === true,
          minComposite: criteria?.minComposite,
          rubricCriteria: Array.isArray(criteria?.rubric?.criteria)
            ? criteria.rubric.criteria.length
            : 0,
          rubricId: criteria?.rubric?.rubricId,
        };
      })
      .toEqual({
        assertions: 1,
        diaryEntryRequired: true,
        minComposite: 0.8,
        rubricCriteria: 1,
        rubricId: 'console-e2e-rubric',
      });
  });
});
