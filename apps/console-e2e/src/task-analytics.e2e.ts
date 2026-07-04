import { randomBytes } from 'node:crypto';

import {
  createDiary,
  createDiaryGrant,
  createTeam,
  listTeams,
} from '@moltnet/api-client';
import { Configuration, FrontendApi } from '@ory/client-fetch';
import { expect, type Page, test } from '@playwright/test';

import {
  type ConnectedAgent,
  provisionAgent,
  seedCompletedFreeformAttempt,
} from './helpers/agent-seed.js';
import {
  CONSOLE_URL,
  createNativeSessionToken,
  createTestUser,
  createTokenSessionApiClient,
  KRATOS_PUBLIC_URL,
  loginViaBrowser,
  registerViaBrowser,
} from './helpers/index.js';

// task-analytics.e2e — covers the /tasks/analytics surface end to end against
// the real activity-analytics endpoint (#1373, API in #1550).
//
// Analytics are only meaningful once tasks have completed attempts, and only
// agents can claim/complete. So this test provisions a fresh agent into a
// shared team, seeds real completed freeform attempts, then drives the human
// console to assert the aggregate KPI pillars, cohort grouping, and the empty
// state. The endpoint recomputes missing attempt stats synchronously per
// request, so the numbers are deterministic immediately after seeding.
test.describe.serial('Task analytics', () => {
  const user = createTestUser({ prefix: 'task-analytics-e2e' });
  const nonce = randomBytes(3).toString('hex');

  let sessionToken: string;
  let sharedTeamId: string;
  const sharedTeamName = `task-analytics-shared-${nonce}`;
  let personalTeamName: string;
  let diaryId: string;
  let agentCtx: ConnectedAgent;

  const SEEDED_COUNT = 3;

  test.afterAll(async () => {
    await agentCtx?.teardown();
  });

  test('registers a human + provisions an agent in a shared team', async ({
    page,
  }) => {
    await registerViaBrowser(page, user);
    await page.goto(CONSOLE_URL);
    await expect(page.getByText('Welcome')).toBeVisible();

    sessionToken = await createNativeSessionToken(user);
    const humanClient = createTokenSessionApiClient(sessionToken);

    const personal = (
      await listTeams({ client: humanClient })
    ).data?.items.find((t) => t.personal);
    if (!personal) throw new Error('expected a personal team');
    personalTeamName = personal.name;

    const kratos = new FrontendApi(
      new Configuration({ basePath: KRATOS_PUBLIC_URL }),
    );
    const session = await kratos.toSession({ xSessionToken: sessionToken });
    const humanSubjectId = session.identity?.id;
    if (!humanSubjectId) throw new Error('Kratos session missing identity id');

    agentCtx = await provisionAgent('task-analytics-e2e');

    const created = await createTeam({
      client: humanClient,
      body: {
        name: sharedTeamName,
        foundingMembers: [
          { subjectId: humanSubjectId, subjectNs: 'Human', role: 'owner' },
          {
            subjectId: agentCtx.genesis.identityId,
            subjectNs: 'Agent',
            role: 'member',
          },
        ],
      },
    });
    if (!created.data?.id) {
      throw new Error(`createTeam failed: ${JSON.stringify(created.error)}`);
    }
    sharedTeamId = created.data.id;

    const diary = await createDiary({
      client: humanClient,
      headers: { 'x-moltnet-team-id': sharedTeamId },
      body: { name: `task-analytics-diary-${nonce}`, visibility: 'private' },
    });
    if (!diary.data?.id) {
      throw new Error(`createDiary failed: ${JSON.stringify(diary.error)}`);
    }
    diaryId = diary.data.id;

    const grant = await createDiaryGrant({
      client: humanClient,
      path: { id: diaryId },
      body: {
        subjectId: agentCtx.genesis.identityId,
        subjectNs: 'Agent',
        role: 'writer',
      },
    });
    if (grant.error || !grant.data) {
      throw new Error(
        `createDiaryGrant failed: ${JSON.stringify(grant.error)}`,
      );
    }
  });

  test('seeds completed freeform attempts for the shared team', async () => {
    for (let i = 0; i < SEEDED_COUNT; i += 1) {
      await seedCompletedFreeformAttempt({
        agent: agentCtx.agent,
        teamId: sharedTeamId,
        diaryId,
        brief: `Analytics seed ${i} ${nonce}`,
        title: `Analytics seed ${i} ${nonce}`,
        requiredExecutorTrustLevel: 'selfDeclared',
      });
    }
  });

  test('renders the KPI pillars with real accepted-output metrics', async ({
    page,
  }) => {
    await selectSharedTeam(page);
    await page.goto(`${CONSOLE_URL}/tasks/analytics`);

    // Page heading + the KPI pillar sections render. Success / Productivity /
    // ROI are unique to the KPI grid; "Hurdles" and "Knowledge leverage" also
    // appear as their own panel headings, so they're asserted via panel content
    // below rather than by their (duplicated) section title.
    await expect(
      page.getByRole('heading', { name: 'Task analytics' }),
    ).toBeVisible();
    for (const pillar of ['Success', 'Productivity', 'ROI']) {
      await expect(page.getByText(pillar, { exact: true })).toBeVisible();
    }

    // Every seeded task was accepted on its first attempt, so the accepted-
    // output rate is 100% and the count reflects the seeded total.
    await expect(page.getByText('Accepted output rate')).toBeVisible();
    await expect(page.getByText('100%').first()).toBeVisible();
    await expect(
      page.getByText(`${SEEDED_COUNT}/${SEEDED_COUNT}`).first(),
    ).toBeVisible();

    // No adverse outcomes → the hurdles panel shows its empty-outcome note.
    await expect(
      page.getByText(/no failed, timed-out, aborted or cancelled/i),
    ).toBeVisible();
  });

  test('grouping by model renders the comparison table', async ({ page }) => {
    await selectSharedTeam(page);
    await page.goto(`${CONSOLE_URL}/tasks/analytics`);

    await page.getByLabel('Compare by').selectOption('providerModel');

    // The comparison table appears with its cohort header and sortable columns.
    await expect(
      page.getByRole('columnheader', { name: /Cohort/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: /Accepted/i }),
    ).toBeVisible();
  });

  test('shows the empty state for a team with no completed tasks', async ({
    page,
  }) => {
    // The personal team has no seeded analytics data → empty state.
    await selectTeamByName(page, personalTeamName);
    await page.goto(`${CONSOLE_URL}/tasks/analytics`);

    await expect(
      page.getByText(/no task activity matches these filters/i),
    ).toBeVisible();
  });

  /** Log in and select the shared (seeded) team in the console team switcher. */
  async function selectSharedTeam(page: Page): Promise<void> {
    await selectTeamByName(page, sharedTeamName);
  }

  /**
   * Log in and switch the active team via the sidebar selector (the idiomatic
   * path — it persists selection and refetches team-scoped data).
   */
  async function selectTeamByName(page: Page, teamName: string): Promise<void> {
    await loginViaBrowser(page, user);
    await page.goto(CONSOLE_URL);
    const teamSelect = page.locator('select[aria-label="Select team"]');
    await teamSelect.selectOption({ label: teamName });
  }
});
