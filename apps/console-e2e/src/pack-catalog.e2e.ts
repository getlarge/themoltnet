/**
 * The pack catalog, end to end against the real API.
 *
 * This spec exists because it was missing. `/packs` shipped calling
 * `GET /packs` with only `limit`/`offset`, an argument the route rejected with
 * `containsEntry is required` — so the page never loaded for anyone. Every
 * console unit test mocks `usePacks`, so nothing exercised the real request,
 * and the defect survived four PRs and a deep review.
 *
 * The load assertion below is the one that would have caught it on day one.
 */
import { randomBytes } from 'node:crypto';

import {
  createDiary,
  createDiaryCustomPack,
  createDiaryEntry,
  createTeam,
  listDiaryPacks,
  listTeams,
} from '@moltnet/api-client';
import { expect, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createNativeSessionToken,
  createTestUser,
  createTokenSessionApiClient,
  expectConsoleOverview,
  loginViaBrowser,
  registerViaBrowser,
  submitKratosForm,
  waitForVerificationData,
} from './helpers/index.js';

interface SeededPacks {
  newerPackId: string;
  olderPackId: string;
  prompt: string;
}

async function seedPackChain(sessionToken: string): Promise<SeededPacks> {
  const nonce = randomBytes(3).toString('hex');
  const prompt = `How does auth work ${nonce}`;
  const client = createTokenSessionApiClient(sessionToken);

  const teamsResponse = await listTeams({ client });
  let team =
    teamsResponse.data?.items.find((candidate) => candidate.personal) ??
    teamsResponse.data?.items[0];

  if (!team) {
    await createTeam({ client, body: { name: `pack-catalog-${nonce}` } });
    const again = await listTeams({ client });
    team = again.data?.items[0];
  }
  if (!team) throw new Error('Expected an accessible team');

  const headers = { 'x-moltnet-team-id': team.id };

  const diaryResponse = await createDiary({
    client,
    headers,
    body: { name: `pack-catalog-diary-${nonce}`, visibility: 'moltnet' },
  });
  if (!diaryResponse.data) {
    throw new Error(
      `createDiary failed: ${JSON.stringify(diaryResponse.error)}`,
    );
  }
  const diaryId = diaryResponse.data.id;

  const entryIds: string[] = [];
  for (const title of [`Auth ordering ${nonce}`, `Token refresh ${nonce}`]) {
    const entry = await createDiaryEntry({
      client,
      headers,
      path: { diaryId },
      body: {
        content: `${title}. Seeded so the catalog has a pack with real members.`,
        entryType: 'semantic',
        title,
        tags: ['auth'],
      },
    });
    if (!entry.data) {
      throw new Error(
        `createDiaryEntry failed: ${JSON.stringify(entry.error)}`,
      );
    }
    entryIds.push(entry.data.id);
  }

  async function makePack(recipe: string, supersedesPackId?: string) {
    const created = await createDiaryCustomPack({
      client,
      headers,
      path: { id: diaryId },
      body: {
        packType: 'custom',
        params: { recipe, prompt },
        entries: entryIds.map((entryId, i) => ({ entryId, rank: i + 1 })),
        ...(supersedesPackId ? { supersedesPackId } : {}),
      },
    });
    if (!created.data) {
      throw new Error(`createPack failed: ${JSON.stringify(created.error)}`);
    }
    const packs = await listDiaryPacks({
      client,
      headers,
      path: { id: diaryId },
    });
    const createdCid = created.data.packCid;
    const match = packs.data?.items.find((pack) => pack.packCid === createdCid);
    if (!match) throw new Error('Persisted pack not found after create');
    return match.id;
  }

  const olderPackId = await makePack('older');
  const newerPackId = await makePack('newer', olderPackId);

  return { newerPackId, olderPackId, prompt };
}

test.describe.serial('Pack catalog', () => {
  const user = createTestUser({ prefix: 'pack-catalog-e2e' });
  let seeded: SeededPacks;

  test('register and seed a pack chain', async ({ page }) => {
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
    await expectConsoleOverview(page);

    const sessionToken = await createNativeSessionToken(user);
    seeded = await seedPackChain(sessionToken);
  });

  test('loads the team catalog without a diary or entry filter', async ({
    page,
  }) => {
    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/packs`);

    await expect(page.getByRole('heading', { name: 'Packs' })).toBeVisible();

    // The regression guard: the page requested `GET /packs` with only
    // limit/offset and got `containsEntry is required`, rendering this notice
    // instead of any catalog.
    await expect(page.getByText('Could not load packs')).toHaveCount(0);
    await expect(page.getByText(/containsEntry/i)).toHaveCount(0);

    await expect(page.getByText(seeded.prompt).first()).toBeVisible();
  });

  test('opens a pack from the catalog and shows its provenance', async ({
    page,
  }) => {
    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/packs`);

    // A real link, not a click handler: keyboard users need a tab stop, and
    // the href is what makes open-in-new-tab and copy-link work.
    const packLink = page.getByRole('link', { name: seeded.prompt }).first();
    await expect(packLink).toHaveAttribute(
      'href',
      `/packs/${seeded.newerPackId}`,
    );
    await packLink.click();

    await expect(page).toHaveURL(new RegExp(`/packs/${seeded.newerPackId}`));

    // Scope every assertion to the named provenance region so an auth page or
    // unrelated graph-like control cannot satisfy this regression guard.
    const provenance = page.getByRole('region', { name: 'Provenance' });
    await expect(
      provenance.getByText('Provenance graph', { exact: true }),
    ).toBeVisible();
    await expect(
      provenance.getByText('Authenticated source', { exact: true }),
    ).toBeVisible();

    // Two packs in the graph: the one being viewed, plus the one it superseded.
    await expect(
      provenance.getByRole('button', { name: /pack node:/i }),
    ).toHaveCount(2);
  });

  test('navigates to the superseded pack from the graph', async ({ page }) => {
    await loginViaBrowser(page, user);
    await page.goto(`${CONSOLE_URL}/packs/${seeded.newerPackId}`);

    const provenance = page.getByRole('region', { name: 'Provenance' });
    const ancestorNode = provenance.getByRole('button', {
      name: new RegExp(`pack node: .*${seeded.olderPackId.slice(0, 8)}`, 'i'),
    });
    await ancestorNode.click();

    const ancestorLink = provenance.getByRole('link', {
      name: 'Open this pack',
    });
    await expect(ancestorLink).toHaveAttribute(
      'href',
      `/packs/${seeded.olderPackId}`,
    );
    await ancestorLink.click();

    await expect(page).toHaveURL(new RegExp(`/packs/${seeded.olderPackId}`));
  });
});
