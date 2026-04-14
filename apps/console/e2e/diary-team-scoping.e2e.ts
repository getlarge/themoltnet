import { randomBytes } from 'node:crypto';

import type { APIRequestContext, Page } from '@playwright/test';
import { expect, request, test } from '@playwright/test';

const KRATOS_PUBLIC_URL =
  process.env['KRATOS_PUBLIC_URL'] ?? 'http://localhost:4433';
const REST_API_URL = process.env['REST_API_URL'] ?? 'http://localhost:8080';
const MAILSLURPER_API_URL =
  process.env['MAILSLURPER_API_URL'] ?? 'http://localhost:4437';
const CONSOLE_URL = process.env['CONSOLE_BASE_URL'] ?? 'http://localhost:5174';

interface TestUser {
  email: string;
  username: string;
  password: string;
}

function createTestUser(): TestUser {
  const nonce = randomBytes(4).toString('hex');
  return {
    email: `diary-scope-${Date.now()}-${nonce}@example.com`,
    username: `dscope_${nonce}`,
    password: `DiaryScope!${nonce}abcd`,
  };
}

async function submitKratosForm(page: Page): Promise<void> {
  await page.locator('form button[type="submit"]').first().click();
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
  } else {
    const sinceIso = new Date().toISOString();
    await submitKratosForm(page);
    const code = await waitForVerificationCode(user.email, { sinceIso });
    await page.locator('input[name="code"]').fill(code);
    await submitKratosForm(page);
  }
  await expect(page).toHaveURL(new RegExp(escapeRegExp(CONSOLE_URL)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getSessionCookie(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find(
    (c) => c.name === 'ory_kratos_session' || c.name.startsWith('ory_session_'),
  );
  if (!sessionCookie) throw new Error('No session cookie found');
  return `${sessionCookie.name}=${sessionCookie.value}`;
}

async function waitForVerificationCode(
  email: string,
  {
    sinceIso,
    maxAttempts = 30,
  }: { sinceIso?: string; maxAttempts?: number } = {},
): Promise<string> {
  const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${MAILSLURPER_API_URL}/mail?pageNumber=1`);
    if (!response.ok) throw new Error(`Mailslurper: ${response.status}`);
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
      // Filter out emails older than the baseline to avoid picking up
      // verification codes from a previous registration step.
      if (sinceMs > 0) {
        const dateSent =
          typeof item['dateSent'] === 'string' ? item['dateSent'] : null;
        const itemMs = dateSent ? Date.parse(dateSent) : Number.NaN;
        if (!Number.isFinite(itemMs) || itemMs < sinceMs) continue;
      }
      const body = typeof item['body'] === 'string' ? item['body'] : '';
      const match = body.match(/\b\d{6}\b/);
      if (match) return match[0];
    }
    await new Promise<void>((r) => {
      setTimeout(r, 2000);
    });
  }
  throw new Error(`No verification code for ${email}`);
}

async function createTeamViaApi(
  api: APIRequestContext,
  name: string,
): Promise<string> {
  const response = await api.post('/teams', { data: { name } });
  expect(
    response.ok() || response.status() === 201 || response.status() === 202,
  ).toBe(true);
  const body = (await response.json()) as { id: string };
  return body.id;
}

async function createDiaryViaApi(
  api: APIRequestContext,
  teamId: string,
  name: string,
): Promise<string> {
  const response = await api.post('/diaries', {
    headers: { 'x-moltnet-team-id': teamId },
    data: { name, visibility: 'moltnet' },
  });
  expect(
    response.ok() || response.status() === 201 || response.status() === 202,
  ).toBe(true);
  const body = (await response.json()) as { id: string };
  return body.id;
}

test.describe.serial('Diary team scoping', () => {
  const user = createTestUser();
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

    const api = await request.newContext({
      baseURL: REST_API_URL,
      extraHTTPHeaders: { Cookie: cookieHeader },
    });
    try {
      alphaTeamId = await createTeamViaApi(api, 'alpha-scoping');
      betaTeamId = await createTeamViaApi(api, 'beta-scoping');
      await createDiaryViaApi(api, alphaTeamId, alphaDiaryName);
      await createDiaryViaApi(api, betaTeamId, betaDiaryName);
    } finally {
      await api.dispose();
    }
  });

  test("diaries page shows only the selected team's diary", async ({
    page,
  }) => {
    await loginViaBrowser(page, user);

    const teamSelect = page.locator('select[aria-label="Select team"]');
    await expect(teamSelect).toBeVisible();

    // Select alpha — only the alpha diary should be visible
    await teamSelect.selectOption({ label: 'alpha-scoping' });
    await page.goto(`${CONSOLE_URL}/diaries`);
    await expect(page.getByText(alphaDiaryName)).toBeVisible();
    await expect(page.getByText(betaDiaryName)).toHaveCount(0);

    // Switch to beta — only the beta diary should be visible
    await teamSelect.selectOption({ label: 'beta-scoping' });
    await expect(page.getByText(betaDiaryName)).toBeVisible();
    await expect(page.getByText(alphaDiaryName)).toHaveCount(0);
  });

  test('personal team scope hides team diaries', async ({ page }) => {
    await loginViaBrowser(page, user);

    const teamSelect = page.locator('select[aria-label="Select team"]');
    await expect(teamSelect).toBeVisible();

    // Find the personal team option (any option that is not alpha/beta).
    const optionTexts = await teamSelect.locator('option').allTextContents();
    const personalLabel = optionTexts.find(
      (t) => !t.includes('alpha-scoping') && !t.includes('beta-scoping'),
    );
    if (!personalLabel) throw new Error('No personal team option found');

    await teamSelect.selectOption({ label: personalLabel });
    await page.goto(`${CONSOLE_URL}/diaries`);

    // Neither team-scoped diary should leak into the personal scope
    await expect(page.getByText(alphaDiaryName)).toHaveCount(0);
    await expect(page.getByText(betaDiaryName)).toHaveCount(0);
  });
});
