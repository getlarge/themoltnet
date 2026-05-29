import { randomBytes } from 'node:crypto';

import { createDiary, createTask, listTeams } from '@moltnet/api-client';
import { expect, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createNativeSessionToken,
  createTestUser,
  createTokenSessionApiClient,
  registerViaBrowser,
  submitKratosForm,
  waitForVerificationData,
} from './helpers/index.js';

// The console is a human-facing app: a human proposes tasks; agents claim and
// execute them ("Only agents may claim tasks"). So this e2e seeds via the
// human session and verifies the board/funnel/pane integration for the
// pending lane. The live agent-turn streaming inside the pane is covered by
// unit tests in libs/task-ui (TaskTurnStream / TaskLivePane with fixtures).
test.describe.serial('Task lanes board', () => {
  const user = createTestUser({ prefix: 'task-lanes-e2e' });
  const nonce = randomBytes(3).toString('hex');
  let firstTaskId: string;

  test('register, seed lane tasks, and open the live pane', async ({
    page,
  }) => {
    // ── Arrange: register + verify + session token ───────────────────────────
    await registerViaBrowser(page, user);

    const codeInput = page.locator('input[name="code"]');
    if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const verification = await waitForVerificationData(user.email);
      if (!verification.code) {
        throw new Error(
          'Registration flow did not produce a verification code',
        );
      }
      await codeInput.fill(verification.code);
      await submitKratosForm(page);
    }

    await page.goto(CONSOLE_URL);
    await expect(page.getByText('Welcome')).toBeVisible();

    const sessionToken = await createNativeSessionToken(user);
    const client = createTokenSessionApiClient(sessionToken);

    const team = (await listTeams({ client })).data?.items.find(
      (candidate) => candidate.personal,
    );
    if (!team) throw new Error('expected a personal team');
    const teamId = team.id;

    // Tasks require a diary scope; create one in the personal team.
    const diary = await createDiary({
      client,
      headers: { 'x-moltnet-team-id': teamId },
      body: { name: `task-lanes-diary-${nonce}`, visibility: 'private' },
    });
    if (!diary.data) {
      throw new Error(`createDiary failed: ${diary.response.status}`);
    }
    const diaryId = diary.data.id;

    // Human onboarding (which commits the `humans` row that tasks FK to) runs
    // as an async DBOS workflow on login, so the first createTask immediately
    // after registration can briefly race the commit. Bounded retry tolerates
    // that startup window; a persistent 409 would be a real bug (see diary:
    // "human write-side id is humans.id, NOT identityId").
    async function seedTask(label: string) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const result = await createTask({
          client,
          body: {
            teamId,
            diaryId,
            taskType: 'curate_pack',
            input: { diaryId, taskPrompt: `${label} ${nonce}` },
          },
        });
        if (result.data) return result.data;
        if (result.response.status !== 409) {
          throw new Error(
            `createTask ${label} failed: ${result.response.status}`,
          );
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 500);
        });
      }
      throw new Error(
        `createTask ${label} kept returning 409 — humans row never committed`,
      );
    }

    // ── Seed: two queued tasks (Pending lane) ────────────────────────────────
    const first = await seedTask('first');
    firstTaskId = first.id;
    await seedTask('second');

    // ── Act: open the board ──────────────────────────────────────────────────
    await page.goto(`${CONSOLE_URL}/tasks`);

    // ── Assert: lane headers + funnel render ─────────────────────────────────
    await expect(
      page.getByText('Pending', { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('Active', { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('Done', { exact: false }).first(),
    ).toBeVisible();

    // The seeded task cards show their short id in the Pending lane.
    await expect(page.getByText(firstTaskId.slice(0, 8)).first()).toBeVisible();

    // ── Act: open the live pane for a seeded task ────────────────────────────
    await page.getByText(firstTaskId.slice(0, 8)).first().click();

    // ── Assert: the live pane opens with the Turns tab ───────────────────────
    await expect(page.getByRole('tab', { name: /turns/i })).toBeVisible();
    // No attempts yet for a freshly-proposed task → the waiting hint shows,
    // pointing the user at the agent-daemon docs.
    await expect(
      page.getByText(/waiting for an agent to claim/i),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /set up an agent daemon/i }),
    ).toBeVisible();
  });
});
