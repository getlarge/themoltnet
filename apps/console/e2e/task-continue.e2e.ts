import { randomBytes } from 'node:crypto';

import {
  claimTask,
  completeTask,
  createDiary,
  createTask,
  getTask,
  listTaskAttempts,
  listTasks,
  listTeams,
  taskHeartbeat,
} from '@moltnet/api-client';
import { computeJsonCid } from '@moltnet/crypto-service';
import { expect, type Page, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createNativeSessionToken,
  createTestUser,
  createTokenSessionApiClient,
  loginViaBrowser,
  registerViaBrowser,
} from './helpers/index.js';

// task-continue.e2e — covers the "Continue this task" affordance added in
// #1303 on TaskAttemptPage. The button + Resumable badge only render when:
//   1. parent task type is `freeform`
//   2. attempt status is `completed`
//   3. attempt.daemonState.slotResumableUntil is set and in the future
//
// (3) is only populated when a daemon writes it into the /complete payload
// (see DaemonState in libs/tasks/src/wire.ts), so the e2e drives the full
// claim → heartbeat → complete sequence against the live rest-api with a
// synthesized daemonState block. There is no daemon process — the test acts
// as one. This is enough to exercise the wire surface the UI reads and the
// server-side async validator the continuation has to pass.

function buildProducerVerification(inputCid: string) {
  return {
    inputCid,
    results: [
      {
        id: 'submit-output',
        kind: 'gate' as const,
        status: 'pass' as const,
        detail: 'submit-output gate satisfied by console e2e seed',
      },
    ],
    passed: true,
  };
}

test.describe.serial('Continue task from console', () => {
  const user = createTestUser({ prefix: 'task-continue-e2e' });
  const nonce = randomBytes(3).toString('hex');
  let teamId: string;
  let sessionToken: string;
  let sourceTaskId: string;

  test('registers + seeds a diary', async ({ page }) => {
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
      body: { name: `task-continue-diary-${nonce}`, visibility: 'private' },
    });
  });

  test('seeds a completed freeform parent with a future slotResumableUntil', async () => {
    const client = createTokenSessionApiClient(sessionToken);

    const createRes = await createTask({
      client,
      headers: { 'x-moltnet-team-id': teamId },
      body: {
        teamId,
        taskType: 'freeform',
        input: {
          brief: `Parent investigation ${nonce}`,
          title: `Source ${nonce}`,
        },
      },
    });
    if (!createRes.data || !('id' in createRes.data)) {
      throw new Error(`createTask failed: ${JSON.stringify(createRes.error)}`);
    }
    sourceTaskId = createRes.data.id;

    const claimRes = await claimTask({
      client,
      path: { id: sourceTaskId },
      body: { leaseTtlSec: 120 },
    });
    if (!claimRes.data || !('attempt' in claimRes.data)) {
      throw new Error(`claimTask failed: ${JSON.stringify(claimRes.error)}`);
    }
    const { attempt, task } = claimRes.data;

    // Heartbeat flips the attempt from `claimed` to `running` — required
    // before /complete is accepted.
    await taskHeartbeat({
      client,
      path: { id: sourceTaskId, n: attempt.attemptN },
      body: { leaseTtlSec: 120 },
    });

    const output = {
      summary: `Parent freeform output for ${nonce}, two sentences long enough to satisfy schema minLength.`,
      verification: buildProducerVerification(task.inputCid),
    };
    const outputCid = await computeJsonCid(output);

    const slotResumableUntil = new Date(
      Date.now() + 60 * 60 * 1000,
    ).toISOString();
    await completeTask({
      client,
      path: { id: sourceTaskId, n: attempt.attemptN },
      body: {
        output,
        outputCid,
        usage: { inputTokens: 1, outputTokens: 1 },
        daemonState: {
          reportedAt: new Date().toISOString(),
          slotResumableUntil,
        },
      },
    });

    // Sanity: the attempt now carries the future slotResumableUntil that
    // gates the UI affordance.
    const attempts = (
      await listTaskAttempts({ client, path: { id: sourceTaskId } })
    ).data;
    const completed = attempts?.find((a) => a.attemptN === attempt.attemptN);
    expect(completed?.status).toBe('completed');
    expect(completed?.daemonState?.slotResumableUntil).toBe(slotResumableUntil);
  });

  async function openSourceAttempt(page: Page) {
    await loginViaBrowser(page, user);
    const sourceTask = (
      await getTask({
        client: createTokenSessionApiClient(sessionToken),
        path: { id: sourceTaskId },
      })
    ).data;
    if (!sourceTask) throw new Error('source task vanished');
    const attemptN = sourceTask.acceptedAttemptN ?? 1;
    await page.goto(
      `${CONSOLE_URL}/tasks/${sourceTaskId}/attempts/${attemptN}`,
    );
  }

  test('shows Resumable badge + Continue button on completed freeform attempt', async ({
    page,
  }) => {
    await openSourceAttempt(page);

    await expect(page.getByText(/Resumable until/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^continue$/i }),
    ).toBeVisible();
  });

  test('Continue opens the dialog pre-populated, submits a continuation task', async ({
    page,
  }) => {
    await openSourceAttempt(page);

    await page.getByRole('button', { name: /^continue$/i }).click();
    // Dialog renders with the source title pre-filled and the continuation
    // submit label.
    await expect(page.getByLabel(/title/i)).toHaveValue(`Source ${nonce}`);
    await expect(
      page.getByRole('button', { name: /continue task/i }),
    ).toBeVisible();
    // Workspace + depends-on inputs are hidden in continuation mode.
    await expect(page.getByLabel(/workspace/i)).toHaveCount(0);

    const briefText = `Continuation brief ${nonce}`;
    await page.getByLabel(/brief/i).fill(briefText);
    await page.getByRole('button', { name: /continue task/i }).click();

    // On success the page navigates to the new task. The new task is a
    // freeform with input.continueFrom set and a task_status:completed
    // claim condition pinned to the source.
    const client = createTokenSessionApiClient(sessionToken);
    let newTaskId: string | undefined;
    await expect
      .poll(
        async () => {
          const tasks = (await listTasks({ client, query: { teamId } })).data
            ?.items;
          const match = tasks?.find(
            (t) =>
              typeof t.input === 'object' &&
              t.input !== null &&
              (t.input as { brief?: unknown }).brief === briefText,
          );
          newTaskId = match?.id;
          return Boolean(match);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    if (!newTaskId) throw new Error('continuation task not found');

    const newTask = (await getTask({ client, path: { id: newTaskId } })).data;
    expect(newTask?.taskType).toBe('freeform');
    const input = newTask?.input as {
      continueFrom?: { taskId?: string; attemptN?: number };
    };
    expect(input?.continueFrom?.taskId).toBe(sourceTaskId);
    expect(input?.continueFrom?.attemptN).toBeGreaterThanOrEqual(1);
    const claim = newTask?.claimCondition as
      | { op?: string; taskId?: string; statuses?: string[] }
      | undefined;
    expect(claim?.op).toBe('task_status');
    expect(claim?.taskId).toBe(sourceTaskId);
    expect(claim?.statuses).toEqual(['completed']);
  });
});
