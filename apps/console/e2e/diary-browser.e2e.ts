import { randomBytes } from 'node:crypto';

import {
  createDiary,
  createDiaryEntry,
  createTeam,
  listTeams,
} from '@moltnet/api-client';
import { expect, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createNativeSessionToken,
  createTestUser,
  createTokenSessionApiClient,
  loginViaBrowser,
  registerViaBrowser,
  submitKratosForm,
  waitForVerificationData,
} from './helpers/index.js';

interface SeededDiary {
  populatedDiaryId: string;
  populatedDiaryName: string;
  emptyDiaryId: string;
  emptyDiaryName: string;
  entryTitle: string;
  entryTag: string;
}

async function seedDiaryFixtures(sessionToken: string): Promise<SeededDiary> {
  const nonce = randomBytes(3).toString('hex');
  const populatedDiaryName = `ui-seeded-diary-${nonce}`;
  const emptyDiaryName = `ui-empty-diary-${nonce}`;
  const entryTitle = `REST API route patterns ${nonce}`;
  const entryTag = `scope:api-${nonce}`;
  const client = createTokenSessionApiClient(sessionToken);

  let teamsResponse = await listTeams({ client });
  let team =
    teamsResponse.data?.items.find((candidate) => candidate.personal) ??
    teamsResponse.data?.items[0];
  if (!team) {
    const createdTeam = await createTeam({
      client,
      body: { name: `Diary browser e2e team ${nonce}` },
    });
    if (!createdTeam.data) {
      throw new Error(
        `Failed to create a team for seeded diary fixtures: ${createdTeam.response.status} ${JSON.stringify(createdTeam.error)}`,
      );
    }

    teamsResponse = await listTeams({ client });
    team =
      teamsResponse.data?.items.find(
        (candidate) => candidate.id === createdTeam.data?.id,
      ) ?? teamsResponse.data?.items[0];
  }
  if (!team) {
    throw new Error('Expected an accessible team after team bootstrap');
  }

  const populatedDiaryResponse = await createDiary({
    client,
    headers: { 'x-moltnet-team-id': team.id },
    body: { name: populatedDiaryName, visibility: 'private' },
  });
  const emptyDiaryResponse = await createDiary({
    client,
    headers: { 'x-moltnet-team-id': team.id },
    body: { name: emptyDiaryName, visibility: 'private' },
  });

  if (!populatedDiaryResponse.data || !emptyDiaryResponse.data) {
    throw new Error('Expected seeded diary creation to succeed');
  }

  await createDiaryEntry({
    client,
    path: { diaryId: populatedDiaryResponse.data.id },
    body: {
      title: entryTitle,
      content:
        'Seeded entry for the console diary browser test. It should appear in the diary detail page and entry detail view.',
      tags: ['decision', entryTag],
      importance: 8,
      entryType: 'procedural',
    },
  });

  await createDiaryEntry({
    client,
    path: { diaryId: populatedDiaryResponse.data.id },
    body: {
      title: `Auth middleware decision ${nonce}`,
      content:
        'Second seeded entry so the page has a real tag cloud and more than one entry card.',
      tags: ['incident', `source:seed-${nonce}`],
      importance: 6,
      entryType: 'semantic',
    },
  });

  return {
    populatedDiaryId: populatedDiaryResponse.data.id,
    populatedDiaryName,
    emptyDiaryId: emptyDiaryResponse.data.id,
    emptyDiaryName,
    entryTitle,
    entryTag,
  };
}

test.describe.serial('Diary browser', () => {
  const user = createTestUser({ prefix: 'diary-e2e' });
  let seeded: SeededDiary;

  test('register and seed deterministic diary data', async ({ page }) => {
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
    seeded = await seedDiaryFixtures(sessionToken);
  });

  test('lists accessible diaries and opens a populated diary', async ({
    page,
  }) => {
    await loginViaBrowser(page, user);
    await expect(page).toHaveURL(/localhost:5174/);

    await page.goto(`${CONSOLE_URL}/diaries`);
    await expect(page.getByRole('heading', { name: 'Diaries' })).toBeVisible();
    await expect(page.getByText(seeded.populatedDiaryName)).toBeVisible();
    await expect(page.getByText(seeded.emptyDiaryName)).toBeVisible();

    await page.getByText(seeded.populatedDiaryName).click();

    await expect(
      page.getByRole('heading', { name: seeded.populatedDiaryName }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Grid' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Timeline' })).toBeVisible();
    await expect(page.getByText(seeded.entryTitle)).toBeVisible();
  });

  test('filters by tag and opens entry detail metadata', async ({ page }) => {
    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/diaries/${seeded.populatedDiaryId}`);

    await page.getByText(seeded.entryTag).first().click();
    await expect(page).toHaveURL(
      new RegExp(`tag=${encodeURIComponent(seeded.entryTag)}`),
    );
    await expect(page.getByText(seeded.entryTitle)).toBeVisible();

    await page.getByText(seeded.entryTitle).click();
    await expect(
      page.getByRole('heading', { name: seeded.entryTitle }),
    ).toBeVisible();
    await expect(page.getByText('CID')).toBeVisible();
    await expect(page.getByText('Signed', { exact: true })).toBeVisible();
    await expect(page.getByText('Tokens')).toBeVisible();
    await expect(page.getByText(seeded.entryTag).first()).toBeVisible();
  });

  test('renders the empty diary state', async ({ page }) => {
    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/diaries/${seeded.emptyDiaryId}`);

    await expect(
      page.getByRole('heading', { name: seeded.emptyDiaryName }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'No entries yet' }),
    ).toBeVisible();
    await expect(
      page.getByText('This diary has no entries yet.'),
    ).toBeVisible();
  });
});
