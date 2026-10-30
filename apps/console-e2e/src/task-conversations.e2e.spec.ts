import { type BrowserContext, expect, type Page, test } from '@playwright/test';

import {
  provisionConversationTeam,
  seedConversation,
} from './helpers/conversation-seed.js';
import {
  CONSOLE_URL,
  createNativeSessionToken,
  createTestUser,
  createTokenSessionApiClient,
  expectConsoleOverview,
  registerViaBrowser,
} from './helpers/index.js';

test.describe('Durable conversations in the console', () => {
  let env: Awaited<ReturnType<typeof provisionConversationTeam>>;
  let cookies: Awaited<ReturnType<BrowserContext['cookies']>>;
  let conversation: Awaited<ReturnType<typeof seedConversation>> | undefined;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const user = createTestUser({ prefix: 'conversation-e2e' });
      await registerViaBrowser(page, user);
      await page.goto(CONSOLE_URL);
      await expectConsoleOverview(page);
      const human = createTokenSessionApiClient(
        await createNativeSessionToken(user),
      );
      env = await provisionConversationTeam(human);
      cookies = await page.context().cookies();
    } finally {
      await page.close();
    }
  });
  test.beforeEach(async ({ context, page }) => {
    await context.addCookies(cookies);
    await page.goto(CONSOLE_URL);
    await page
      .getByRole('combobox', { name: 'Select team' })
      .selectOption(env.teamId);
  });
  test.afterEach(async () => {
    await conversation?.close();
    conversation = undefined;
  });
  test.afterAll(async () => {
    await env?.agent.teardown();
  });

  async function openAttempt(page: Page) {
    await page.goto(
      `${CONSOLE_URL}/tasks/${conversation!.taskId}/attempts/${conversation!.attemptN}`,
    );
  }

  test('keeps the live/history boundary and reading position while an older page is pending', async ({
    page,
  }) => {
    conversation = await seedConversation(env, 105);
    await openAttempt(page);
    await expect(page.getByText('Message 105', { exact: true })).toBeVisible();
    await expect(page.getByText('Message 006', { exact: true })).toBeAttached();

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested!: () => void;
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    await page.route('**/conversations/*?beforeEntryId=*', async (route) => {
      requested();
      await held;
      await route.continue();
    });
    try {
      await page
        .getByRole('button', { name: 'Load older', exact: true })
        .click();
      await started;
      const boundary = page.getByText('Message 006', { exact: true });
      const top = (await boundary.boundingBox())!.y;
      await conversation.append('Message 106');
      await expect(
        page.getByText('Message 106', { exact: true }),
      ).toBeAttached();
      // A live append must not pull a reader away from the history button.
      expect(Math.abs((await boundary.boundingBox())!.y - top)).toBeLessThan(5);
      release();
      await expect(
        page.getByText('Message 001', { exact: true }),
      ).toBeAttached();
      await expect(boundary).toBeAttached();
      await expect(
        page.getByRole('button', { name: 'Load older', exact: true }),
      ).toHaveCount(0);
      expect(Math.abs((await boundary.boundingBox())!.y - top)).toBeLessThan(5);
    } finally {
      release();
    }

    await conversation.partial('A live partial answer');
    await expect(
      page.getByText('A live partial answer', { exact: true }),
    ).toBeAttached();
    await conversation.partial('The updated partial answer');
    await expect(
      page.getByText('The updated partial answer', { exact: true }),
    ).toBeAttached();
    await expect(
      page.getByText('A live partial answer', { exact: true }),
    ).toHaveCount(0);
    await conversation.append('Final answer from Durable');
    await conversation.complete();
    await expect(
      page.getByText('Final answer from Durable', { exact: true }),
    ).toBeAttached();
    await expect(
      page.getByText('The updated partial answer', { exact: true }),
    ).toHaveCount(0);
    // Reload verifies the rendered transcript comes from persisted API data.
    await page.reload();
    await expect(
      page.getByText('Final answer from Durable', { exact: true }),
    ).toBeVisible();
  });

  test('loads expanded subagents serially, discovers final children, and closes the main stream', async ({
    page,
  }) => {
    conversation = await seedConversation(env);
    const children = await conversation.subagents(20);
    let streams = 0;
    let ended = 0;
    const childReads: string[] = [];
    let active = 0;
    let maxActive = 0;
    page.on('request', (request) => {
      if (
        request.url().endsWith('/events') &&
        request.url().includes('/conversations/')
      )
        streams++;
    });
    page.on('requestfinished', (request) => {
      if (
        request.url().endsWith('/events') &&
        request.url().includes('/conversations/')
      )
        ended++;
    });
    page.on('requestfailed', (request) => {
      if (
        request.url().endsWith('/events') &&
        request.url().includes('/conversations/')
      )
        ended++;
    });
    await page.route(/\/conversations\/\d+$/, async (route) => {
      const id = route.request().url().split('/').at(-1)!;
      if (!children.includes(id)) return route.continue();
      childReads.push(id);
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        await route.fulfill({ response: await route.fetch() });
      } finally {
        active--;
      }
    });
    await openAttempt(page);
    await expect(
      page.getByText(`Subagent conversation ${children.at(-1)}`, {
        exact: true,
      }),
    ).toBeAttached();
    expect(streams).toBe(1);
    expect(childReads).toEqual([]);
    await page
      .getByText(`Subagent conversation ${children[0]}`, { exact: true })
      .click();
    // route.fetch() keeps its upstream request alive after browser cancellation.
    // Finish the first expansion before measuring the two-child serial pass.
    await expect(
      page.getByText('Subagent result 1', { exact: true }),
    ).toBeVisible();
    await page
      .getByText(`Subagent conversation ${children[1]}`, { exact: true })
      .click();
    await expect(
      page.getByText('Subagent result 2', { exact: true }),
    ).toBeVisible();
    expect(new Set(childReads)).toEqual(new Set(children.slice(0, 2)));
    expect(maxActive).toBe(1);
    expect(streams).toBe(1);

    const final = await conversation.subagents(1);
    await conversation.complete();
    await expect(
      page.getByText(`Subagent conversation ${final[0]}`, { exact: true }),
    ).toBeAttached();
    await expect.poll(() => ended).toBe(streams);
  });

  test('recovers a skipped live window after history was exhausted', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    conversation = await seedConversation(env, 105);
    await page.route('**/conversations/*/events', (route) =>
      route.fulfill({ status: 503, body: 'Unavailable' }),
    );
    await openAttempt(page);
    await expect(page.getByText('Message 105', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Load older', exact: true }).click();
    await expect(page.getByText('Message 001', { exact: true })).toBeAttached();
    await expect(
      page.getByRole('button', { name: 'Load older', exact: true }),
    ).toHaveCount(0);
    // Keep the UI mounted while the store advances beyond one complete page.
    await page.route(/\/conversations\/\d+$/, (route) =>
      route.fulfill({ status: 503, body: 'Unavailable' }),
    );
    await expect(
      page.getByText('Live updates unavailable. Retrying…', { exact: true }),
    ).toBeVisible();
    for (let i = 106; i <= 250; i++) await conversation.append(`Message ${i}`);
    await page.unroute(/\/conversations\/\d+$/);
    await page
      .getByRole('button', { name: 'Retry conversation', exact: true })
      .click();
    await expect(page.getByText('Message 250', { exact: true })).toBeAttached();
    await page.getByRole('button', { name: 'Load older', exact: true }).click();
    await expect(page.getByText('Message 106', { exact: true })).toBeAttached();
    await expect(page.getByText('Message 150', { exact: true })).toBeAttached();
    await expect(page.locator('[data-conversation-message]')).toHaveCount(250);
  });

  test('stops child reads while another pane tab is visible', async ({
    page,
  }) => {
    conversation = await seedConversation(env);
    const [child] = await conversation.subagents(1);
    let reads = 0;
    page.on('request', (request) => {
      if (request.url().endsWith(`/conversations/${child}`)) reads++;
    });
    await page.goto(
      `${CONSOLE_URL}/tasks?view=board&selected=${conversation.taskId}`,
    );
    const label = page.getByText(`Subagent conversation ${child}`, {
      exact: true,
    });
    await label.click();
    await expect(
      page.getByText('Subagent result 1', { exact: true }),
    ).toBeVisible();
    await page.getByRole('tab', { name: /^Events/ }).click();
    const before = reads;
    // Observe longer than a polling interval; absence of requests is the assertion.
    await page.waitForTimeout(2_500);
    expect(reads).toBe(before);
    await page.getByRole('tab', { name: 'Turns', exact: true }).click();
    await expect(label.locator('..').locator('..')).toBeAttached();
    await expect(
      page.getByText('Subagent result 1', { exact: true }),
    ).toBeHidden();
    await page.waitForTimeout(2_500);
    expect(reads).toBe(before);
    await label.click();
    await expect.poll(() => reads).toBeGreaterThan(before);
  });

  for (const status of [404, 503])
    test(`shows discovery ${status} and recovers through retry`, async ({
      page,
    }) => {
      conversation = await seedConversation(env);
      await page.route('**/conversations', (route) =>
        route.fulfill({
          status,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status, title: 'Unavailable' }),
        }),
      );
      await openAttempt(page);
      await expect(
        page.getByText('Conversations could not be loaded.', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText('Messages', { exact: true })).toHaveCount(0);
      await page.unroute('**/conversations');
      await page
        .getByRole('button', { name: 'Retry conversations', exact: true })
        .click();
      await expect(
        page.getByText('Message 001', { exact: true }),
      ).toBeVisible();
    });

  test('shows stale content when live reads fail and recovers polling from the real API', async ({
    page,
  }) => {
    conversation = await seedConversation(env);
    await page.route('**/conversations/*/events', (route) =>
      route.fulfill({ status: 503, body: 'Unavailable' }),
    );
    let reads = 0;
    await page.route(/\/conversations\/\d+$/, async (route) => {
      reads++;
      if (reads === 1) return route.continue();
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 503 }),
      });
    });
    await openAttempt(page);
    await expect(page.getByText('Message 001', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Live updates unavailable. Retrying…', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Message 001', { exact: true })).toBeVisible();
    await conversation.append('Recovered through polling');
    await page.unroute(/\/conversations\/\d+$/);
    await expect(
      page.getByText('Recovered through polling', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Live updates unavailable. Retrying…', { exact: true }),
    ).toHaveCount(0);
  });
});
