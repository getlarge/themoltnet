import {
  createMcpTestHarness,
  type McpTestHarness,
} from '@moltnet/mcp-test-harness';
import { expect, test } from '@playwright/test';

let harness: McpTestHarness;

test.beforeAll(async () => {
  harness = await createMcpTestHarness();
});

test.afterAll(async () => {
  await harness.teardown();
});

test('loads the tasks MCP app through the host bridge', async ({ page }) => {
  const url = new URL('/', 'http://127.0.0.1:8080');
  url.searchParams.set('tool', 'tasks_app_open');
  url.searchParams.set('autorun', '1');
  url.searchParams.set('args', '{}');
  url.searchParams.set('server', `${harness.mcpBaseUrl}/mcp`);
  url.searchParams.set('clientId', harness.agent.clientId);
  url.searchParams.set('clientSecret', harness.agent.clientSecret);

  await page.goto(url.toString());

  await expect(page.locator('h1')).toContainText('Basic Host Fixture');
  await expect(page.locator('#status')).toContainText('completed');
  await expect(page.locator('#app-state')).toContainText('app-ready');
  await expect(page.locator('#app-frame')).toBeVisible();
  await expect(page.locator('#result')).toContainText(
    'ui://moltnet/tasks.html',
  );
});
