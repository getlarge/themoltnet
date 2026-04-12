import { randomBytes } from 'node:crypto';

import type { Page } from '@playwright/test';
import { expect, request, test } from '@playwright/test';

const KRATOS_PUBLIC_URL =
  process.env['KRATOS_PUBLIC_URL'] ?? 'http://localhost:4433';
const REST_API_URL = process.env['REST_API_URL'] ?? 'http://localhost:8080';
const MAILSLURPER_API_URL =
  process.env['MAILSLURPER_API_URL'] ?? 'http://localhost:4437';

interface TestUser {
  email: string;
  username: string;
  password: string;
}

function createTestUser(): TestUser {
  const nonce = randomBytes(4).toString('hex');
  return {
    email: `team-e2e-${Date.now()}-${nonce}@example.com`,
    username: `team_${nonce}`,
    password: `TeamE2E!${nonce}abcd`,
  };
}

async function submitKratosForm(page: Page): Promise<void> {
  await page.locator('form button[type="submit"]').first().click();
}

async function registerViaBrowser(page: Page, user: TestUser): Promise<void> {
  const returnTo = encodeURIComponent('http://localhost:5174/');
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
  maxAttempts = 30,
): Promise<string> {
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
  cookieHeader: string,
  name: string,
): Promise<string> {
  const api = await request.newContext({
    baseURL: REST_API_URL,
    extraHTTPHeaders: { Cookie: cookieHeader },
  });
  const response = await api.post('/teams', {
    data: { name },
  });
  expect(
    response.ok() || response.status() === 201 || response.status() === 202,
  ).toBe(true);
  const body = (await response.json()) as { id: string };
  await api.dispose();
  return body.id;
}

test.describe.serial('Team selector', () => {
  const user = createTestUser();
  let cookieHeader: string;

  test('register and create two teams', async ({ page }) => {
    await registerViaBrowser(page, user);

    // Handle verification if needed
    const codeInput = page.locator('input[name="code"]');
    if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const code = await waitForVerificationCode(user.email);
      await codeInput.fill(code);
      await submitKratosForm(page);
    }

    await page.goto('http://localhost:5174/');
    await expect(page.getByText('Welcome')).toBeVisible();
    cookieHeader = await getSessionCookie(page);

    // Create two additional teams via API
    await createTeamViaApi(cookieHeader, 'alpha-team');
    await createTeamViaApi(cookieHeader, 'beta-team');
  });

  test('sidebar shows team selector dropdown with multiple teams', async ({
    page,
  }) => {
    // Login
    const returnTo = encodeURIComponent('http://localhost:5174/');
    await page.goto(
      `${KRATOS_PUBLIC_URL}/self-service/login/browser?return_to=${returnTo}`,
    );
    await page.locator('input[name="identifier"]').fill(user.email);
    const passwordField = page.locator('input[name="password"]');
    if (await passwordField.isVisible({ timeout: 1500 }).catch(() => false)) {
      await passwordField.fill(user.password);
      await submitKratosForm(page);
    } else {
      await submitKratosForm(page);
      const code = await waitForVerificationCode(user.email);
      await page.locator('input[name="code"]').fill(code);
      await submitKratosForm(page);
    }

    await expect(page).toHaveURL(/localhost:5174/);
    await expect(page.getByText('Welcome')).toBeVisible();

    // Team selector should be a <select> (multiple teams)
    const teamSelect = page.locator('select[aria-label="Select team"]');
    await expect(teamSelect).toBeVisible();

    // Should have at least 3 options (personal + alpha + beta)
    const options = teamSelect.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Verify team names appear in options
    const optionTexts = await options.allTextContents();
    expect(optionTexts.some((t) => t.includes('alpha-team'))).toBe(true);
    expect(optionTexts.some((t) => t.includes('beta-team'))).toBe(true);
  });

  test('switching team updates the overview', async ({ page }) => {
    // Login
    const returnTo = encodeURIComponent('http://localhost:5174/');
    await page.goto(
      `${KRATOS_PUBLIC_URL}/self-service/login/browser?return_to=${returnTo}`,
    );
    await page.locator('input[name="identifier"]').fill(user.email);
    const passwordField = page.locator('input[name="password"]');
    if (await passwordField.isVisible({ timeout: 1500 }).catch(() => false)) {
      await passwordField.fill(user.password);
      await submitKratosForm(page);
    } else {
      await submitKratosForm(page);
      const code = await waitForVerificationCode(user.email);
      await page.locator('input[name="code"]').fill(code);
      await submitKratosForm(page);
    }

    await expect(page).toHaveURL(/localhost:5174/);
    await expect(page.getByText('Welcome')).toBeVisible();

    // Select alpha-team
    const teamSelect = page.locator('select[aria-label="Select team"]');
    await teamSelect.selectOption({ label: 'alpha-team' });

    // Overview should show the selected team name
    await expect(page.getByText('Team: alpha-team')).toBeVisible();

    // Switch to beta-team
    await teamSelect.selectOption({ label: 'beta-team' });
    await expect(page.getByText('Team: beta-team')).toBeVisible();
  });

  test('team selection persists across page reload', async ({ page }) => {
    // Login
    const returnTo = encodeURIComponent('http://localhost:5174/');
    await page.goto(
      `${KRATOS_PUBLIC_URL}/self-service/login/browser?return_to=${returnTo}`,
    );
    await page.locator('input[name="identifier"]').fill(user.email);
    const passwordField = page.locator('input[name="password"]');
    if (await passwordField.isVisible({ timeout: 1500 }).catch(() => false)) {
      await passwordField.fill(user.password);
      await submitKratosForm(page);
    } else {
      await submitKratosForm(page);
      const code = await waitForVerificationCode(user.email);
      await page.locator('input[name="code"]').fill(code);
      await submitKratosForm(page);
    }

    await expect(page).toHaveURL(/localhost:5174/);

    // Select beta-team
    const teamSelect = page.locator('select[aria-label="Select team"]');
    await expect(teamSelect).toBeVisible();
    await teamSelect.selectOption({ label: 'beta-team' });
    await expect(page.getByText('Team: beta-team')).toBeVisible();

    // Reload
    await page.reload();
    await expect(page.getByText('Welcome')).toBeVisible();

    // beta-team should still be selected
    await expect(page.getByText('Team: beta-team')).toBeVisible();
  });
});
