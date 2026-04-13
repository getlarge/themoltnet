import { randomBytes } from 'node:crypto';

import {
  createClient,
  createDiary,
  createDiaryEntry,
  createTeam,
  listTeams,
} from '@moltnet/api-client';
import { Configuration, FrontendApi } from '@ory/client-fetch';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const KRATOS_PUBLIC_URL =
  process.env['KRATOS_PUBLIC_URL'] ?? 'http://localhost:4433';
const REST_API_URL = process.env['REST_API_URL'] ?? 'http://localhost:8000';
const MAILSLURPER_API_URL =
  process.env['MAILSLURPER_API_URL'] ?? 'http://localhost:4437';
const CONSOLE_URL = process.env['CONSOLE_BASE_URL'] ?? 'http://localhost:5174';

interface TestUser {
  email: string;
  username: string;
  password: string;
}

interface SeededDiary {
  populatedDiaryId: string;
  populatedDiaryName: string;
  emptyDiaryId: string;
  emptyDiaryName: string;
  entryTitle: string;
  entryTag: string;
}

function createTestUser(): TestUser {
  const nonce = randomBytes(4).toString('hex');
  return {
    email: `diary-e2e-${Date.now()}-${nonce}@example.com`,
    username: `diary_${nonce}`,
    password: `DiaryE2E!${nonce}abcd`,
  };
}

async function submitKratosForm(page: Page): Promise<void> {
  await page.locator('form button[type="submit"]').first().click();
}

async function waitForVerificationData(
  email: string,
  maxAttempts = 30,
): Promise<{ code?: string; link?: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${MAILSLURPER_API_URL}/mail?pageNumber=1`);
    if (!response.ok) {
      throw new Error(`Failed to query Mailslurper: ${response.status}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const items = Array.isArray(payload['mailItems'])
      ? (payload['mailItems'] as Record<string, unknown>[])
      : [];

    for (const item of items) {
      const toAddresses = Array.isArray(item['toAddresses'])
        ? (item['toAddresses'] as Record<string, unknown>[])
        : [];
      const matchesEmail = toAddresses.some((addr) => {
        const address = addr['address'] ?? addr['Address'];
        return (
          typeof address === 'string' &&
          address.toLowerCase() === email.toLowerCase()
        );
      });
      if (!matchesEmail) continue;

      const body = typeof item['body'] === 'string' ? item['body'] : '';
      const html = typeof item['Body'] === 'string' ? item['Body'] : '';
      const code = body.match(/\b\d{6}\b/)?.[0];
      const link = `${body}\n${html}`
        .match(/https?:\/\/[^\s"'<>)]*/g)
        ?.find((candidate) => candidate.includes('/self-service/verification'));

      if (code || link) {
        return { code, link };
      }
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2000);
    });
  }

  throw new Error(`Timed out waiting for verification data for ${email}`);
}

async function registerViaBrowser(page: Page, user: TestUser): Promise<void> {
  const returnTo = encodeURIComponent(`${CONSOLE_URL}/`);
  await page.goto(
    `${KRATOS_PUBLIC_URL}/self-service/registration/browser?return_to=${returnTo}`,
  );

  await page.locator('input[name="traits.email"]').fill(user.email);
  await page.locator('input[name="traits.username"]').fill(user.username);

  const passwordField = page.locator('input[name="password"]');
  if (await passwordField.isVisible({ timeout: 1500 }).catch(() => false)) {
    await passwordField.fill(user.password);
  }

  await submitKratosForm(page);

  const followupPasswordField = page.locator('input[name="password"]');
  if (
    await followupPasswordField.isVisible({ timeout: 3000 }).catch(() => false)
  ) {
    await followupPasswordField.fill(user.password);
    await submitKratosForm(page);
  }
}

async function loginViaBrowser(page: Page, user: TestUser): Promise<void> {
  const returnTo = encodeURIComponent(`${CONSOLE_URL}/`);
  await page.goto(
    `${KRATOS_PUBLIC_URL}/self-service/login/browser?return_to=${returnTo}`,
  );

  await page.locator('input[name="identifier"]').fill(user.email);

  const passwordField = page.locator('input[name="password"]');
  if (await passwordField.isVisible({ timeout: 1500 }).catch(() => false)) {
    await passwordField.fill(user.password);
    await submitKratosForm(page);
    return;
  }

  await submitKratosForm(page);

  const verification = await waitForVerificationData(user.email);
  if (!verification.code) {
    throw new Error('Login flow did not produce a verification code');
  }
  await page.locator('input[name="code"]').fill(verification.code);
  await submitKratosForm(page);
}

async function createNativeSessionToken(user: TestUser): Promise<string> {
  const kratos = new FrontendApi(
    new Configuration({ basePath: KRATOS_PUBLIC_URL }),
  );
  const loginFlow = await kratos.createNativeLoginFlow();
  const loginResult = await kratos.updateLoginFlow({
    flow: loginFlow.id,
    updateLoginFlowBody: {
      method: 'password',
      identifier: user.email,
      password: user.password,
    },
  });

  if (!loginResult.session_token) {
    throw new Error('Native login did not return a session token');
  }

  return loginResult.session_token;
}

function createSessionClient() {
  return createClient({
    baseUrl: REST_API_URL,
  });
}

async function seedDiaryFixtures(sessionToken: string): Promise<SeededDiary> {
  const nonce = randomBytes(3).toString('hex');
  const populatedDiaryName = `ui-seeded-diary-${nonce}`;
  const emptyDiaryName = `ui-empty-diary-${nonce}`;
  const entryTitle = `REST API route patterns ${nonce}`;
  const entryTag = `scope:api-${nonce}`;
  const client = createSessionClient();
  client.interceptors.request.use((request) => {
    request.headers.set('X-Moltnet-Session-Token', sessionToken);
    return request;
  });

  let teamsResponse = await listTeams({
    client,
  });
  let team =
    teamsResponse.data?.items.find((candidate) => candidate.personal) ??
    teamsResponse.data?.items[0];
  if (!team) {
    const createdTeam = await createTeam({
      client,
      body: {
        name: `Diary browser e2e team ${nonce}`,
      },
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
    body: {
      name: populatedDiaryName,
      visibility: 'private',
    },
  });
  const emptyDiaryResponse = await createDiary({
    client,
    headers: { 'x-moltnet-team-id': team.id },
    body: {
      name: emptyDiaryName,
      visibility: 'private',
    },
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
  const user = createTestUser();
  let seeded: SeededDiary;

  test('register and seed deterministic diary data', async ({ page }) => {
    await registerViaBrowser(page, user);

    const codeInput = page.locator('input[name="code"]');
    if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const verification = await waitForVerificationData(user.email);
      if (!verification.code) {
        throw new Error('Registration flow did not produce a verification code');
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
    await expect(page.getByText('Tags')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Grid' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Timeline' })).toBeVisible();
    await expect(page.getByText(seeded.entryTitle)).toBeVisible();
  });

  test('filters by tag and opens entry detail metadata', async ({ page }) => {
    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/diaries/${seeded.populatedDiaryId}`);

    await page.getByText(seeded.entryTag).click();
    await expect(page).toHaveURL(new RegExp(`tag=${seeded.entryTag}`));
    await expect(page.getByText(seeded.entryTitle)).toBeVisible();

    await page.getByText(seeded.entryTitle).click();
    await expect(page.getByRole('heading', { name: seeded.entryTitle })).toBeVisible();
    await expect(page.getByText('CID')).toBeVisible();
    await expect(page.getByText('Signed')).toBeVisible();
    await expect(page.getByText('Tokens')).toBeVisible();
    await expect(page.getByText(seeded.entryTag)).toBeVisible();
  });

  test('renders the empty diary state', async ({ page }) => {
    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/diaries/${seeded.emptyDiaryId}`);

    await expect(
      page.getByRole('heading', { name: seeded.emptyDiaryName }),
    ).toBeVisible();
    await expect(page.getByText('No entries yet')).toBeVisible();
    await expect(
      page.getByText('This diary has no entries yet.'),
    ).toBeVisible();
  });
});
