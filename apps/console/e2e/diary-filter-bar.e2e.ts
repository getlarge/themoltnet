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
  diaryId: string;
  diaryName: string;
  authEntryTitle: string;
  dbEntryTitle: string;
  reflectionTitle: string;
  authTag: string;
  dbTag: string;
  excludeTag: string;
}

async function seedDiary(sessionToken: string): Promise<SeededDiary> {
  const nonce = randomBytes(3).toString('hex');
  const diaryName = `ui-filter-${nonce}`;
  const authTag = `area-auth-${nonce}`;
  const dbTag = `area-db-${nonce}`;
  const excludeTag = `draft-${nonce}`;
  const authEntryTitle = `Auth decision ${nonce}`;
  const dbEntryTitle = `DB index choice ${nonce}`;
  const reflectionTitle = `Reflection on cadence ${nonce}`;

  const client = createTokenSessionApiClient(sessionToken);

  const teamsResponse = await listTeams({ client });
  let team =
    teamsResponse.data?.items.find((candidate) => candidate.personal) ??
    teamsResponse.data?.items[0];
  if (!team) {
    const created = await createTeam({
      client,
      body: { name: `filter-bar e2e team ${nonce}` },
    });
    if (!created.data) throw new Error('team create failed');
    const refreshed = await listTeams({ client });
    team = refreshed.data?.items.find((t) => t.id === created.data?.id);
  }
  if (!team) throw new Error('no team available');

  const diary = await createDiary({
    client,
    headers: { 'x-moltnet-team-id': team.id },
    body: { name: diaryName, visibility: 'private' },
  });
  if (!diary.data) throw new Error('diary create failed');

  await createDiaryEntry({
    client,
    path: { diaryId: diary.data.id },
    body: {
      title: authEntryTitle,
      content:
        'Decision about authentication middleware and JWT verification flow.',
      tags: ['decision', authTag],
      importance: 7,
      entryType: 'semantic',
    },
  });
  await createDiaryEntry({
    client,
    path: { diaryId: diary.data.id },
    body: {
      title: dbEntryTitle,
      content: 'Database index choice for high-cardinality lookups.',
      tags: ['decision', dbTag],
      importance: 6,
      entryType: 'semantic',
    },
  });
  await createDiaryEntry({
    client,
    path: { diaryId: diary.data.id },
    body: {
      title: reflectionTitle,
      content: 'Session reflection notes; should be excluded by tag.',
      tags: ['reflection', excludeTag],
      importance: 4,
      entryType: 'reflection',
    },
  });

  return {
    diaryId: diary.data.id,
    diaryName,
    authEntryTitle,
    dbEntryTitle,
    reflectionTitle,
    authTag,
    dbTag,
    excludeTag,
  };
}

test.describe.serial('Diary detail filter bar', () => {
  const user = createTestUser({ prefix: 'filter-bar-e2e' });
  let seeded: SeededDiary;

  test('register, verify, and seed diary fixtures', async ({ page }) => {
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

    const sessionToken = await createNativeSessionToken(user);
    seeded = await seedDiary(sessionToken);
  });

  test('search, multi-tag include/exclude, chips, explore round-trip', async ({
    page,
  }) => {
    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/diaries/${seeded.diaryId}`);

    await expect(
      page.getByRole('heading', { name: seeded.diaryName }),
    ).toBeVisible();

    // All three entries visible initially
    await expect(page.getByText(seeded.authEntryTitle)).toBeVisible();
    await expect(page.getByText(seeded.dbEntryTitle)).toBeVisible();
    await expect(page.getByText(seeded.reflectionTitle)).toBeVisible();

    // Search narrows to the auth entry
    const search = page.getByRole('searchbox', { name: /search entries/i });
    await search.fill('JWT');
    await expect(page.getByText(seeded.authEntryTitle)).toBeVisible();
    await expect(page.getByText(seeded.dbEntryTitle)).not.toBeVisible();

    // Clear via Esc
    await search.press('Escape');
    await expect(page.getByText(seeded.dbEntryTitle)).toBeVisible();

    // Open Tags facet, include auth tag, exclude reflection tag
    await page.getByRole('button', { name: /tags filter/i }).click();
    await page
      .getByRole('button', { name: `Include tag: ${seeded.authTag}` })
      .click();
    await page
      .getByRole('button', { name: `Exclude tag: ${seeded.excludeTag}` })
      .click();
    await page.keyboard.press('Escape');

    // Active chip row reflects filters
    await expect(page.getByText(seeded.authTag)).toBeVisible();
    await expect(page.getByText(seeded.excludeTag)).toBeVisible();
    await expect(page.getByText(seeded.reflectionTitle)).not.toBeVisible();

    // Clear all
    await page.getByRole('button', { name: /clear all filters/i }).click();
    await expect(page.getByText(seeded.authEntryTitle)).toBeVisible();
    await expect(page.getByText(seeded.dbEntryTitle)).toBeVisible();
    await expect(page.getByText(seeded.reflectionTitle)).toBeVisible();

    // "/" focuses search
    await page.keyboard.press('/');
    await expect(search).toBeFocused();

    // Explore round-trip
    await page.getByRole('button', { name: /explore tags/i }).click();
    await expect(page).toHaveURL(
      new RegExp(`/diaries/${seeded.diaryId}/explore$`),
    );
    await page
      .getByRole('button', { name: new RegExp(seeded.dbTag) })
      .first()
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/diaries/${seeded.diaryId}\\?tags=`),
    );
    await expect(page.getByText(seeded.dbEntryTitle)).toBeVisible();
    await expect(page.getByText(seeded.authEntryTitle)).not.toBeVisible();

    // URL state survives reload
    await page.reload();
    await expect(page.getByText(seeded.dbEntryTitle)).toBeVisible();
    await expect(page.getByText(seeded.authEntryTitle)).not.toBeVisible();
  });
});
