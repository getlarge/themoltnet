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

interface MailRecord {
  to: string[];
  body?: string;
  html?: string;
  subject?: string;
}

interface MailVerificationData {
  code?: string;
  link?: string;
}

function createTestUser(): TestUser {
  const nonce = Math.random().toString(36).slice(2, 10);
  return {
    email: `console-e2e-${Date.now()}-${nonce}@example.com`,
    username: `console_${nonce}`,
    password: `ConsoleE2E!${nonce}abcd`,
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

  // Kratos can present registration in two steps:
  // 1) traits (email/username), 2) credential selection (password/code).
  const followupPasswordField = page.locator('input[name="password"]');
  if (
    await followupPasswordField.isVisible({ timeout: 3000 }).catch(() => false)
  ) {
    await followupPasswordField.fill(user.password);
    await submitKratosForm(page);
  }
}

async function loginViaBrowser(page: Page, user: TestUser): Promise<void> {
  const returnTo = encodeURIComponent('http://localhost:5174/');
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
    throw new Error('Login code flow did not produce a verification code');
  }
  await page.locator('input[name="code"]').fill(verification.code);
  await submitKratosForm(page);
}

async function fetchMailPage(): Promise<unknown> {
  const response = await fetch(`${MAILSLURPER_API_URL}/mail?pageNumber=1`);
  if (!response.ok) {
    throw new Error(`Failed to query Mailslurper: ${response.status}`);
  }
  return response.json();
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function extractRecipient(record: unknown): string[] {
  if (!record || typeof record !== 'object') return [];
  const obj = record as Record<string, unknown>;
  const toAddresses = asArray<unknown>(
    obj['toAddresses'] ?? obj['ToAddresses'],
  );
  return toAddresses
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!entry || typeof entry !== 'object') return undefined;
      const address =
        (entry as Record<string, unknown>)['address'] ??
        (entry as Record<string, unknown>)['Address'];
      return typeof address === 'string' ? address : undefined;
    })
    .filter((value): value is string => !!value);
}

function parseMailRecords(payload: unknown): MailRecord[] {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  const items = asArray<unknown>(obj['mailItems'] ?? obj['MailItems']);

  return items.map((item) => {
    if (!item || typeof item !== 'object') return { to: [] };
    const mail = item as Record<string, unknown>;
    return {
      to: extractRecipient(mail),
      body: typeof mail['body'] === 'string' ? mail['body'] : undefined,
      html:
        typeof mail['body'] === 'string'
          ? undefined
          : typeof mail['Body'] === 'string'
            ? mail['Body']
            : undefined,
      subject:
        typeof mail['subject'] === 'string'
          ? mail['subject']
          : typeof mail['Subject'] === 'string'
            ? mail['Subject']
            : undefined,
    };
  });
}

function extractVerificationLink(mail: MailRecord): string | null {
  const content = `${mail.body ?? ''}\n${mail.html ?? ''}`;
  const matches = content.match(/https?:\/\/[^\s"'<>)]*/g) ?? [];
  for (const candidate of matches) {
    if (candidate.includes('/self-service/verification')) {
      return candidate;
    }
  }
  return null;
}

function extractVerificationCode(mail: MailRecord): string | null {
  const content = `${mail.body ?? ''}\n${mail.html ?? ''}`;
  const match = content.match(/\b\d{6}\b/);
  return match ? match[0] : null;
}

async function waitForVerificationData(
  email: string,
  maxAttempts = 30,
): Promise<MailVerificationData> {
  for (let i = 0; i < maxAttempts; i++) {
    const payload = await fetchMailPage();
    const records = parseMailRecords(payload);
    for (const record of records) {
      if (
        !record.to.some((addr) => addr.toLowerCase() === email.toLowerCase())
      ) {
        continue;
      }
      const code = extractVerificationCode(record);
      const link = extractVerificationLink(record);
      if (code || link) {
        return { code: code ?? undefined, link: link ?? undefined };
      }
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });
  }

  throw new Error(`Timed out waiting for verification email data for ${email}`);
}

async function getKratosSessionCookie(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => {
    return (
      cookie.name === 'ory_kratos_session' ||
      cookie.name.startsWith('ory_session_')
    );
  });
  expect(sessionCookie).toBeDefined();
  if (!sessionCookie) {
    throw new Error('Kratos session cookie is missing');
  }
  return `${sessionCookie.name}=${sessionCookie.value}`;
}

test.describe.serial('Kratos browser cookie auth', () => {
  const user = createTestUser();

  test('registration flow sends verification email and establishes a session', async ({
    page,
  }) => {
    await registerViaBrowser(page, user);

    const verification = await waitForVerificationData(user.email);

    const codeInput = page.locator('input[name="code"]');
    if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      if (!verification.code) {
        throw new Error('Registration code flow did not produce a code');
      }
      await codeInput.fill(verification.code);
      await submitKratosForm(page);
    } else if (verification.link) {
      await page.goto(verification.link);
    }

    await page.goto('http://localhost:5174/');
    await expect(
      page.getByText('Your MoltNet dashboard overview.'),
    ).toBeVisible();
    await getKratosSessionCookie(page);
  });

  test('login flow sets session cookie and redirects to console', async ({
    page,
  }) => {
    await loginViaBrowser(page, user);

    await expect(page).toHaveURL(/http:\/\/localhost:5174\//);
    await expect(
      page.getByText('Your MoltNet dashboard overview.'),
    ).toBeVisible();
    await getKratosSessionCookie(page);
  });

  test('authenticated REST API call succeeds using cookie only', async ({
    page,
  }) => {
    await loginViaBrowser(page, user);
    const cookieHeader = await getKratosSessionCookie(page);

    const api = await request.newContext({
      baseURL: REST_API_URL,
      extraHTTPHeaders: {
        Cookie: cookieHeader,
      },
    });
    const response = await api.get('/diaries');
    const body = (await response.json()) as { items?: unknown[] };

    expect(response.ok()).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    await api.dispose();
  });

  test('logout invalidates the session', async ({ page }) => {
    await loginViaBrowser(page, user);
    const cookieHeader = await getKratosSessionCookie(page);

    await page
      .getByRole('button', { name: 'Logout' })
      .click({ noWaitAfter: true });
    await expect(async () => {
      const cookies = await page.context().cookies();
      const activeSession = cookies.find((cookie) => {
        return (
          cookie.name === 'ory_kratos_session' ||
          cookie.name.startsWith('ory_session_')
        );
      });
      expect(activeSession).toBeUndefined();
    }).toPass({ timeout: 15_000 });

    const api = await request.newContext({
      baseURL: REST_API_URL,
      extraHTTPHeaders: {
        Cookie: cookieHeader,
      },
    });
    const response = await api.get('/diaries');

    expect(response.status()).toBe(401);
    await api.dispose();
  });
});
