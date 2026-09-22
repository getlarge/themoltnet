import { $, browser, expect } from '@wdio/globals';

import { field } from './journey-helpers.js';
import {
  catalogue,
  expectNoAxeViolations,
  preset,
  PRESETS_KEY,
  readSavedPresets,
  running,
  status,
  WINDOW_SIZES,
} from './run-fixtures.js';

let generation = 0;
let start: Awaited<ReturnType<typeof browser.tauri.mock>>;

async function mount() {
  await browser.tauri.restoreAllMocks();
  const url = new URL(await browser.getUrl());
  url.hash = '';
  url.search = `?journey=${++generation}`;
  await browser.url(url.href);
  for (const [command, value] of Object.entries({
    desktop_status: running,
    desktop_control_status: status,
    desktop_operator_configured: true,
    desktop_catalogue: catalogue,
    desktop_preset_storage_scope: { storageScope: '' },
    desktop_providers: {},
    desktop_subscriptions: [],
    desktop_run_logs: { lines: ['Fixture log'] },
  })) {
    await (await browser.tauri.mock(command)).mockResolvedValue(value);
  }
  start = await browser.tauri.mock('desktop_start_run');
  await start.mockResolvedValue(status.runs[0]);
  await browser.execute(
    (saved, key) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify([saved]));
      window.dispatchEvent(new Event('desktop-e2e:mount'));
    },
    preset,
    PRESETS_KEY,
  );
  await expect($('button=New run')).toBeEnabled();
  return start;
}

// Select labels are associated through their native label elements.

describe('Run-flow audit regressions', () => {
  beforeEach(mount);

  it('preserves a run draft through setup navigation', async () => {
    await $('a=Saved worker').click();
    await field('Runtime profile').selectByAttribute('value', 'quick');
    await $('a*=Providers').click();
    await $('a=Runs').click();
    await expect(field('Runtime profile')).toHaveValue('quick');
  });

  it('prefills Run again from the captured run instead of current defaults', async () => {
    await $('button=Run again').click();
    await expect(field('Identity')).toHaveValue('previous-agent');
    await expect(field('Runtime profile')).toHaveValue('quick');
    await expect(
      $('//label[span[normalize-space()="pr_review"]]/input'),
    ).toBeSelected();
  });

  it('launches edited presets without updating saved defaults', async () => {
    await $('a=Saved worker').click();
    await field('Runtime profile').selectByAttribute('value', 'quick');
    await $('button=Start run').click();
    const saved = await readSavedPresets();
    expect(saved).toEqual([preset]);
    await start.update();
    expect(start.mock.calls.map(([args]) => args)).toEqual([
      {
        // The legacy preset's diary follows the current default, which the
        // daemon resolves for explicit General work.
        spec: {
          agent: 'first-agent',
          teamId: 'team',
          projectId: null,
          profiles: ['quick'],
          taskTypes: ['freeform'],
          mode: 'poll',
        },
      },
    ]);
  });

  it('updates a preset only through an explicit save action', async () => {
    await $('a=Saved worker').click();
    await field('Runtime profile').selectByAttribute('value', 'quick');
    await $('button=Update preset').click();
    await start.update();
    expect(start.mock.calls).toHaveLength(0);
    const saved = await readSavedPresets();
    expect(saved[0].profileIds).toEqual(['quick']);
  });

  it('offers catalogue retry without directing an API failure to enrollment', async () => {
    const failed = await browser.tauri.mock('desktop_catalogue');
    await failed.mockImplementation(() => {
      throw new Error('Catalogue unavailable');
    });
    await browser.execute(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await $('button=New run').click();
    await expect($('button=Retry catalogue')).toBeDisplayed();
    await expect($('button=Enroll or renew team access')).not.toExist();
    await failed.mockResolvedValue(catalogue);
    await $('button=Retry catalogue').click();
    await expect(field('Team')).toHaveValue('team');
  });

  it('keeps the sidebar beside the content at the default width', async () => {
    await browser.setWindowSize(820, 720);
    const positions = await browser.execute(() => {
      const rail = document
        .querySelector('.run-center__rail')!
        .getBoundingClientRect();
      const pane = document
        .querySelector('.run-center__pane')!
        .getBoundingClientRect();
      return { railRight: rail.right, paneLeft: pane.left };
    });
    expect(positions.paneLeft).toBeGreaterThanOrEqual(positions.railRight - 1);
  });
  it('restores keyboard focus when returning to the draft', async () => {
    await $('a=Saved worker').click();
    await field('Runtime profile').click();
    await browser.keys('Tab');
    const focused = await browser.execute(
      () => document.activeElement?.outerHTML,
    );
    await $('a*=Providers').click();
    await $('button=Return to run draft').click();
    expect(
      await browser.execute(() => document.activeElement?.outerHTML),
    ).toEqual(focused);
  });

  it('reports a failed explicit preset write without launching', async () => {
    await $('a=Saved worker').click();
    await browser.execute(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      };
    });
    await $('button=Update preset').click();
    await expect($('[role="alert"]')).toHaveText(
      expect.stringContaining('could not be saved'),
    );
    await start.update();
    expect(start.mock.calls).toHaveLength(0);
  });
  for (const [width, height] of WINDOW_SIZES) {
    it(`keeps the composer accessible and scrollable at ${width}×${height}`, async () => {
      await browser.setWindowSize(width, height);
      await $('a=Saved worker').click();
      await expect(field('Runtime profile')).toHaveValue('careful');
      await expectNoAxeViolations();
      await $('button=Start run').scrollIntoView();
      await expect($('button=Start run')).toBeClickable();
      expect(
        await browser.execute(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await browser.saveScreenshot(
        `test-results/desktop-composer-${width}.png`,
      );
    });
  }
  it('offers verification retry when the upstream team catalogue is unavailable', async () => {
    await (
      await browser.tauri.mock('desktop_catalogue')
    ).mockResolvedValue({
      ...catalogue,
      defaultTeamId: null,
      teams: catalogue.teams.map((team) => ({
        ...team,
        available: false,
        blockers: [
          {
            code: 'agent_key_unavailable',
            message: 'Team resources could not be read.',
            remedy: 'Check connectivity and retry.',
          },
        ],
      })),
    });
    await browser.execute(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    await $('button=New run').click();
    await expect($('button=Retry catalogue')).toBeDisplayed();
    await expect($('button=Enroll or renew team access')).not.toExist();
  });

  it('explains when a captured runtime profile is no longer available', async () => {
    await (
      await browser.tauri.mock('desktop_catalogue')
    ).mockResolvedValue({
      ...catalogue,
      profiles: catalogue.profiles.filter((profile) => profile.id !== 'quick'),
    });
    await $('button=Run again').click();
    await expect($('button=Start run')).toBeDisabled();
    await expect($('body')).toHaveText(
      expect.stringContaining(
        'Selected runtime profile is no longer available',
      ),
    );
  });

  it('keeps a newly saved preset selected for explicit updates', async () => {
    await $('button=New run').click();
    await field('Runtime profile').selectByAttribute('value', 'careful');
    await $(
      '//label[normalize-space()="Preset name"]/following-sibling::input',
    ).setValue('New worker');
    await $('button=Save preset').click();
    await expect($('button=Update preset')).toBeDisplayed();
    await field('Runtime profile').selectByAttribute('value', 'quick');
    await $('button=Update preset').click();
    const saved = await readSavedPresets();
    expect(saved).toHaveLength(2);
    expect(
      saved.find((entry) => entry.name === 'New worker')?.profileIds,
    ).toEqual(['quick']);
    await start.update();
    expect(start.mock.calls).toHaveLength(0);
  });

  it('shows captured run logs and repeats from run details', async () => {
    await $('button=Logs').click();
    await expect($('body')).toHaveText(expect.stringContaining('Fixture log'));
    await $('button=Run again').click();
    await expect(field('Identity')).toHaveValue('previous-agent');
    await expect(field('Runtime profile')).toHaveValue('quick');
  });
});
