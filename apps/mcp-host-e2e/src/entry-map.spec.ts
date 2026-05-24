import {
  createMcpTestHarness,
  type McpTestHarness,
} from '@moltnet/mcp-test-harness';
import { expect, type Page, test } from '@playwright/test';

let harness: McpTestHarness;
const seededEntryIds: string[] = [];

/** Seed a handful of namespaced-tag entries so a zone resolves a real mosaic. */
async function seedEntry(content: string, tags: string[]): Promise<string> {
  const response = await fetch(
    `${harness.restApiUrl}/diaries/${harness.privateDiaryId}/entries`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${harness.agent.accessToken}`,
        'x-moltnet-team-id': harness.personalTeamId,
      },
      body: JSON.stringify({ content, tags, entryType: 'semantic' }),
    },
  );
  if (!response.ok) {
    throw new Error(`seed failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { id: string };
  return body.id;
}

test.beforeAll(async () => {
  harness = await createMcpTestHarness();
  seededEntryIds.push(
    await seedEntry('Chose Drizzle migrations over raw SQL.', [
      'scope:infra',
      'decision',
    ]),
    await seedEntry('Adopted Ory Keto for authorization.', [
      'scope:infra',
      'scope:auth',
    ]),
    await seedEntry('Reflected on agent autonomy boundaries.', [
      'topic:autonomy',
      'reflection',
    ]),
  );
});

test.afterAll(async () => {
  await harness?.teardown();
});

/** Build the `args` for entries_map_open with a fully-formed map of one zone. */
function mapArgs(): string {
  return JSON.stringify({
    diary_id: harness.privateDiaryId,
    map: {
      diaryName: 'e2e diary',
      totalEntries: seededEntryIds.length,
      sampledEntries: seededEntryIds.length,
      overview: 'A small diary with infra decisions and a reflection.',
      zones: [
        {
          id: 'infra',
          label: 'Infra decisions',
          why: 'Database and authorization choices.',
          territory: 'scope:infra',
          entryIds: seededEntryIds.slice(0, 2),
          provenance: {
            basis: 'tag:scope:infra',
            searches: [{ tags: ['scope:infra'] }],
          },
        },
      ],
    },
  });
}

async function openMap(page: Page) {
  const url = new URL('/', 'http://127.0.0.1:8082');
  url.searchParams.set('tool', 'entries_map_open');
  url.searchParams.set('autorun', '1');
  url.searchParams.set('args', mapArgs());
  url.searchParams.set('server', `${harness.mcpBaseUrl}/mcp`);
  url.searchParams.set('clientId', harness.agent.clientId);
  url.searchParams.set('clientSecret', harness.agent.clientSecret);
  await page.goto(url.toString());

  await expect(page.locator('#app-state')).toContainText('app-ready');
  await expect(page.locator('#app-frame')).toBeVisible();
  await expect(page.locator('#result')).toContainText(
    'ui://moltnet/entries/explore.html',
  );
}

/**
 * The app runs two iframes deep: #app-frame loads the sandbox proxy, which
 * mounts the app HTML in a nested srcdoc iframe. Reach the app content there.
 */
function appFrame(page: Page) {
  return page.frameLocator('#app-frame').frameLocator('iframe');
}

test('mounts the diary map app and serves its resource', async ({ page }) => {
  await openMap(page);
  const frame = appFrame(page);
  // First paint: the overview shows the agent's orientation + the zone card.
  await expect(frame.locator('.view-title')).toContainText('e2e diary');
  await expect(frame.locator('.zone-card')).toContainText('Infra decisions');
});

test('focusing a zone shows its entry mosaic with a legible count', async ({
  page,
}) => {
  await openMap(page);
  const frame = appFrame(page);

  await frame.locator('.zone-card', { hasText: 'Infra decisions' }).click();

  // "What am I looking at": header states the zone + a showing-N count.
  await expect(frame.locator('.view-title')).toContainText('Infra decisions');
  await expect(frame.locator('.view-count')).toContainText('showing');
  // The mosaic resolves the two seeded infra entries by id.
  await expect(frame.locator('.mosaic')).toBeVisible();
});

test('saving a zone materializes an unpinned draft pack', async ({ page }) => {
  await openMap(page);
  const frame = appFrame(page);

  await frame.locator('.zone-card', { hasText: 'Infra decisions' }).click();
  await frame.locator('.pivot.save', { hasText: 'Save this zone' }).click();

  // After save the button advances to the validate affordance.
  await expect(frame.locator('.pivot.save')).toContainText('validate');
});
