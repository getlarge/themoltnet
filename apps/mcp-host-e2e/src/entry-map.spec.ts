import {
  type Client,
  createClient,
  createDiaryEntry,
} from '@moltnet/api-client';
import {
  createMcpTestHarness,
  type McpTestHarness,
} from '@moltnet/mcp-test-harness';
import { expect, type Page, test } from '@playwright/test';

let harness: McpTestHarness;
let client: Client;
const seededEntryIds: string[] = [];

/** Seed a handful of namespaced-tag entries so a zone resolves a real mosaic. */
async function seedEntry(content: string, tags: string[]): Promise<string> {
  const { data, error } = await createDiaryEntry({
    client,
    auth: () => harness.agent.accessToken,
    headers: { 'x-moltnet-team-id': harness.personalTeamId },
    path: { diaryId: harness.privateDiaryId },
    body: { content, tags, entryType: 'semantic' },
  });
  if (error || !data) {
    throw new Error(`seed failed: ${JSON.stringify(error)}`);
  }
  return data.id;
}

// Seeded entries with KNOWN content — the round-trip test asserts these exact
// strings appear in the rendered mosaic, proving entry_ids actually resolved
// (not just that a zone card rendered). The titles double as the assertion.
const INFRA_DRIZZLE = 'Chose Drizzle migrations over raw SQL.';
const INFRA_KETO = 'Adopted Ory Keto for authorization.';
const AUTONOMY = 'Reflected on agent autonomy boundaries.';

test.beforeAll(async () => {
  harness = await createMcpTestHarness();
  client = createClient({ baseUrl: harness.restApiUrl });
  seededEntryIds.push(
    await seedEntry(INFRA_DRIZZLE, ['scope:infra', 'decision']),
    await seedEntry(INFRA_KETO, ['scope:infra', 'scope:auth']),
    await seedEntry(AUTONOMY, ['topic:autonomy', 'reflection']),
  );
});

test.afterAll(async () => {
  await harness?.teardown();
});

/**
 * The map an interpreting agent would push to `entries_map_open`. It uses the
 * CANONICAL contract field names from EntryMapZoneSchema (snake_case
 * `entry_ids`, `why`, `territory`) — the same schema the server validates this
 * payload against at the tool boundary. If a field name here drifts from the
 * schema, the round-trip fails: the server rejects it, or the mosaic renders
 * empty and the content assertion below fails. (The empty-zones bug was an
 * opaque `Array(Unknown)` schema + a fixture that hand-wrote a field name the
 * app didn't read; this fixture is validated by the real server instead.)
 */
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
          entry_ids: seededEntryIds.slice(0, 2), // the two scope:infra entries
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

/**
 * The full contract round-trip — the test that would have caught the
 * empty-zones bug. It is deliberately NOT self-confirming: instead of asserting
 * "a mosaic element exists", it asserts the mosaic renders the EXACT CONTENT of
 * the seeded entries the zone's `entry_ids` point at. That only passes if:
 *   1. the agent map (canonical entry_ids) survives `entries_map_open`'s
 *      server-side TypeBox validation,
 *   2. the app parser reads `entry_ids`,
 *   3. the adapter calls `entries_list` with those ids over the host bridge, and
 *   4. diary-ui renders the resolved entries.
 * A field-name drift anywhere in that chain leaves the mosaic empty → fail.
 */
test('focusing a zone resolves its entry_ids to the real seeded entries', async ({
  page,
}) => {
  await openMap(page);
  const frame = appFrame(page);

  // Agent → app: click the zone the agent labeled.
  await frame.locator('.zone-card', { hasText: 'Infra decisions' }).click();

  // "What am I looking at": header + an honest "showing N of M" count.
  await expect(frame.locator('.view-title')).toContainText('Infra decisions');
  await expect(frame.locator('.view-count')).toContainText('showing 2 of 2');

  // The PROOF: the two scope:infra entries' actual content is on screen,
  // meaning entry_ids round-tripped all the way to rendered cards.
  const mosaic = frame.locator('.mosaic');
  await expect(mosaic).toContainText(INFRA_DRIZZLE);
  await expect(mosaic).toContainText(INFRA_KETO);
  // The autonomy entry is NOT in this zone, so it must not appear.
  await expect(mosaic).not.toContainText(AUTONOMY);
});

/**
 * Curation round-trip: saving a zone materializes it as an unpinned draft
 * context pack (pack id resolved from the create CID via packs_provenance),
 * then the affordance offers to validate (pin) it.
 */
test('saving a zone materializes an unpinned draft pack', async ({ page }) => {
  await openMap(page);
  const frame = appFrame(page);

  await frame.locator('.zone-card', { hasText: 'Infra decisions' }).click();
  await frame.locator('.pivot.save', { hasText: 'Save this zone' }).click();

  // After save the button advances to the validate affordance (no error).
  await expect(frame.locator('.pivot.save')).toContainText('validate');
  await expect(frame.locator('.next-steps-error')).toHaveCount(0);
});
