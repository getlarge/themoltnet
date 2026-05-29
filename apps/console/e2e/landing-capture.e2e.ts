import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listTasks } from '@moltnet/api-client';
import { expect, type Page, test } from '@playwright/test';

import {
  CONSOLE_URL,
  createTokenSessionApiClient,
  loginViaBrowser,
} from './helpers/index.js';

// Local-only landing-screenshot capture (run after landing-setup.e2e.ts seeds
// the shared team + a daemon populates it). NOT a CI test: it depends on a
// state file written by the setup spec and a live agent run, neither of which
// exists in CI. Skipped automatically when the state file is absent.

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', '..', 'landing', 'public', 'screenshots');
const STATE_FILE = join(tmpdir(), 'landing-shots.json');

interface State {
  email: string;
  password: string;
  sessionToken: string;
  teamId: string;
  diaryId: string;
}

const hasState = existsSync(STATE_FILE);
const state: State = hasState
  ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  : ({ teamId: '' } as State);

async function applyClientState(page: Page, theme: 'dark' | 'light') {
  // Seed localStorage before any app script runs so the theme + active team are
  // correct on first paint. Also paint html/body the theme background so any
  // viewport area outside the app root has no light gutter in the screenshot.
  await page.addInitScript(
    ([t, team]) => {
      localStorage.setItem('moltnet-theme', t);
      localStorage.setItem('moltnet-selected-team', team);
      const bg = t === 'light' ? '#f7f7fb' : '#08080d';
      const style = document.createElement('style');
      style.textContent = `html,body,#root{background:${bg} !important;margin:0;}`;
      document.documentElement.appendChild(style);
    },
    [theme, state.teamId],
  );
}

// Screenshot the app root so the capture is exactly the painted UI — no
// viewport gutter / white border around it.
async function shoot(page: Page, path: string) {
  const root = page.locator('#root');
  await root.screenshot({ path });
}

test.describe.serial('Landing capture', () => {
  // Local capture tooling only — skip in CI (no seeded state file / agent run).
  test.skip(!hasState, 'no landing-shots state file — run landing-setup first');

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  // 2x device scale → retina-sharp PNGs, displayed at half size on the landing.
  test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } });

  for (const theme of ['dark', 'light'] as const) {
    test(`capture board, pane, and create dialog — ${theme}`, async ({
      page,
    }) => {
      const suffix = theme === 'dark' ? '' : '-light';

      await applyClientState(page, theme);
      await loginViaBrowser(page, {
        email: state.email,
        password: state.password,
        username: '',
      });

      // ── Board ────────────────────────────────────────────────────────────
      await page.goto(`${CONSOLE_URL}/tasks`);
      await expect(
        page.getByText('Pending', { exact: false }).first(),
      ).toBeVisible();
      // Click Refresh so freshly-seeded tasks load, then wait for the Pending
      // lane to actually show a card (not just the header).
      const refresh = page.getByRole('button', { name: /refresh/i });
      if (await refresh.isVisible().catch(() => false)) {
        await refresh.click();
      }
      await expect(page.getByText('Freeform').first()).toBeVisible();
      // Poll (re-clicking Refresh) until the DONE lane actually shows a card —
      // a "Completed" status badge inside a card, not the toolbar filter chip.
      // This proves the fresh per-lane data loaded rather than the stale cache.
      await expect(async () => {
        await refresh.click();
        await expect(
          page.getByText('Completed', { exact: true }).first(),
        ).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30000 });
      await page.waitForTimeout(1500);
      await shoot(page, join(OUT_DIR, `board${suffix}.png`));

      // ── Live pane: pick a task that has attempts (running/completed) ───────
      const client = createTokenSessionApiClient(state.sessionToken);
      const done = await listTasks({
        client,
        query: { teamId: state.teamId, statuses: ['completed'], limit: 1 },
      });
      const active = await listTasks({
        client,
        query: {
          teamId: state.teamId,
          statuses: ['running', 'dispatched'],
          limit: 1,
        },
      });
      const target = done.data?.items[0] ?? active.data?.items[0] ?? undefined;
      if (target) {
        await page.getByText(target.id.slice(0, 8)).first().click();
        await expect(page.getByRole('tab', { name: /turns/i })).toBeVisible();
        // Best-effort: wait for the turn stream to load (the messages query is
        // async). Don't fail the capture if it stays on the waiting hint.
        await page
          .getByText(/no turns yet/i)
          .waitFor({ state: 'detached', timeout: 12000 })
          .catch(() => undefined);
        await page.waitForTimeout(800);
        await shoot(page, join(OUT_DIR, `live-pane${suffix}.png`));
      }

      // ── Create dialog ──────────────────────────────────────────────────────
      await page.goto(`${CONSOLE_URL}/tasks`);
      await page.getByRole('button', { name: /new task/i }).click();
      await expect(
        page.getByRole('button', { name: /create task/i }),
      ).toBeVisible();
      await page
        .getByLabel(/^brief/i)
        .fill(
          'Draft the v0.4 changelog grouped by feat / fix / chore from the merged PRs since the last release tag. Link each entry to its PR.',
        );
      const title = page.getByLabel(/title/i);
      if (await title.isVisible().catch(() => false)) {
        await title.fill('v0.4 changelog');
      }
      await page.waitForTimeout(400);
      await shoot(page, join(OUT_DIR, `create-task${suffix}.png`));
    });
  }
});
