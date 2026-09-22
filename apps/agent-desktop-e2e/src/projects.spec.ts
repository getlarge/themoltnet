import AxeBuilder from '@axe-core/webdriverio';
import { $, browser, expect } from '@wdio/globals';

import { catalogue, running, status } from './run-fixtures.js';

const shared = {
  id: 'project',
  teamId: 'team',
  name: 'Research workspace',
  description: 'Shared research',
  defaultDiaryId: 'diary',
  archived: false,
};
const location = {
  name: 'Laptop',
  teamId: 'team',
  projectId: 'project',
  apiUrl: 'https://api.themolt.net',
  source: '/work/research',
  effectiveSource: '/work/research',
  strategy: 'existing',
  default: true,
  readiness: { ready: true },
};
const field = (label: string) =>
  $(`//label[normalize-space()="${label}"]/following-sibling::select`);
let start: Awaited<ReturnType<typeof browser.tauri.mock>>;

describe('Desktop Projects journeys', () => {
  beforeEach(async () => {
    await browser.tauri.restoreAllMocks();
    const url = new URL(await browser.getUrl());
    url.search = `?projects=${Date.now()}`;
    await browser.url(url.href);
    for (const [command, value] of Object.entries({
      desktop_status: running,
      desktop_control_status: status,
      desktop_operator_configured: true,
      desktop_catalogue: { ...catalogue, projects: [shared] },
      desktop_preset_storage_scope: { storageScope: '' },
      desktop_providers: {},
      desktop_subscriptions: [],
      desktop_project_locations: { locations: [location] },
      desktop_choose_project_folder: '/work/new',
      desktop_save_project_location: {
        ...location,
        name: 'Second location',
        source: '/work/new',
        effectiveSource: '/work/new',
        default: false,
      },
    }))
      await (await browser.tauri.mock(command)).mockResolvedValue(value);
    start = await browser.tauri.mock('desktop_start_run');
    await start.mockResolvedValue(status.runs[0]);
    await browser.execute(() => {
      localStorage.clear();
      window.dispatchEvent(new Event('desktop-e2e:mount'));
    });
    await expect($('button=New run')).toBeEnabled();
  });

  it('separates shared administration from explicit local setup without autostart', async () => {
    await $('a=Projects').click();
    await expect($('h2=Shared with the team')).toBeDisplayed();
    await expect($('h2=On this computer')).toBeDisplayed();
    await expect($('h3=Laptop')).toBeDisplayed();
    await $('button=Add local location').click();
    await $(
      '//label[normalize-space()="Location name"]/following-sibling::input',
    ).setValue('Second location');
    await $('button=Choose folder').click();
    await expect(
      $('//label[normalize-space()="Folder"]/following-sibling::input'),
    ).toHaveValue('/work/new');
    await $('button=Save location').click();
    await expect($('h3=Second location')).toBeDisplayed();
    await start.update();
    expect(start.mock.calls).toHaveLength(0);
  });

  it('preserves composition through targeted project recovery and launches the selected location', async () => {
    await $('button=New run').click();
    await field('Runtime profile').selectByAttribute('value', 'careful');
    await field('Project').selectByAttribute('value', 'project');
    await expect(field('Local location')).toHaveValue('Laptop');
    await $('button=Manage local locations').click();
    await expect($('h2=On this computer')).toBeDisplayed();
    await $('button=Return to run draft').click();
    await expect(field('Runtime profile')).toHaveValue('careful');
    await expect(field('Project')).toHaveValue('project');
    await $('button=Start run').click();
    await start.update();
    // No diary was chosen: the daemon applies the location's at start.
    expect(start.mock.calls[0]?.[0]).toEqual({
      spec: {
        agent: 'first-agent',
        teamId: 'team',
        profiles: ['careful'],
        taskTypes: ['freeform'],
        mode: 'poll',
        projectId: 'project',
        location: 'Laptop',
      },
    });
  });
  it('keeps unavailable locations visible and blocks launch until repaired', async () => {
    await (
      await browser.tauri.mock('desktop_project_locations')
    ).mockResolvedValue({
      locations: [
        {
          ...location,
          readiness: {
            ready: false,
            message:
              'The source folder is unavailable. Choose an existing folder.',
          },
        },
      ],
    });
    await $('button=New run').click();
    await field('Runtime profile').selectByAttribute('value', 'careful');
    await field('Project').selectByAttribute('value', 'project');
    await expect($('button=Start run')).toBeDisabled();
    await expect($('body')).toHaveText(
      expect.stringContaining('The source folder is unavailable'),
    );
    await $('button=Manage local locations').click();
    await (
      await browser.tauri.mock('desktop_project_locations')
    ).mockResolvedValue({ locations: [location] });
    await $('button=Return to run draft').click();
    await expect($('button=Start run')).toBeEnabled();
  });

  it('retries failed location discovery without mistaking it for empty setup', async () => {
    const locations = await browser.tauri.mock('desktop_project_locations');
    await locations.mockImplementation(() => {
      throw new Error('Unavailable');
    });
    await $('button=New run').click();
    await field('Project').selectByAttribute('value', 'project');
    await expect($('button=Retry locations')).toBeDisplayed();
    await locations.mockResolvedValue({ locations: [location] });
    await $('button=Retry locations').click();
    await expect(field('Local location')).toHaveValue('Laptop');
  });

  it('requires a location choice when several locations have no default', async () => {
    await (
      await browser.tauri.mock('desktop_project_locations')
    ).mockResolvedValue({
      locations: [
        { ...location, default: false },
        { ...location, name: 'Travel', default: false },
      ],
    });
    await $('button=New run').click();
    await field('Runtime profile').selectByAttribute('value', 'careful');
    await field('Project').selectByAttribute('value', 'project');
    await expect(field('Local location')).toHaveValue('');
    await expect($('button=Start run')).toBeDisabled();
    await field('Local location').selectByAttribute('value', 'Travel');
    await expect($('button=Start run')).toBeEnabled();
  });

  it('keeps project overrides in explicitly saved presets and never updates them on launch', async () => {
    await $('button=New run').click();
    await field('Runtime profile').selectByAttribute('value', 'careful');
    await field('Project').selectByAttribute('value', 'project');
    await expect(field('Local location')).toHaveValue('Laptop');
    await $(
      '//label[normalize-space()="Preset name"]/following-sibling::input',
    ).setValue('Project worker');
    await $('button=Save preset').click();
    await expect($('button=Update preset')).toBeDisplayed();
    const saved = await browser.execute(() =>
      localStorage.getItem('moltnet.run-presets.v1'),
    );
    expect((JSON.parse(saved ?? '[]') as unknown[])[0]).toMatchObject({
      projectId: 'project',
      location: 'Laptop',
    });
    await $('summary*=Advanced').click();
    await $('button=Choose folder for this run').click();
    await expect(
      $(
        '//label[normalize-space()="Run folder override"]/following-sibling::input',
      ),
    ).toHaveValue('/work/new');
    await $('button=Start run').click();
    await start.update();
    expect(start.mock.calls[0]?.[0]).toMatchObject({
      spec: {
        projectId: 'project',
        location: 'Laptop',
        source: '/work/new',
        strategy: 'existing',
      },
    });
    expect(
      await browser.execute(() =>
        localStorage.getItem('moltnet.run-presets.v1'),
      ),
    ).toBe(saved);
  });

  it('replays a repeated project run from its request, not its captured folder', async () => {
    const calls = await browser.tauri.mock('desktop_control_status');
    await calls.update();
    const previousCalls = calls.mock.calls.length;
    await calls.mockResolvedValue({
      ...status,
      runs: [
        {
          ...status.runs[0],
          // Requested: the location by name. Resolved: its folder back then.
          projectId: 'project',
          location: 'Laptop',
          workspace: {
            projectId: 'project',
            location: 'Laptop',
            source: '/work/captured',
            strategy: 'existing',
            diaryId: 'diary',
          },
        },
      ],
    });
    // Refresh the status through the normal polling cycle.
    await browser.waitUntil(
      async () => {
        await calls.update();
        return calls.mock.calls.length > previousCalls;
      },
      { timeout: 15000 },
    );
    await $('button=Run again').click();
    await expect(field('Project')).toHaveValue('project');
    await expect(field('Local location')).toHaveValue('Laptop');
    // The location's current folder applies, not the one captured last time.
    await expect($('body')).toHaveText(
      expect.stringContaining('/work/research'),
    );
    await expect($('body')).not.toHaveText(
      expect.stringContaining('/work/captured'),
    );
    await $('button=Start run').click();
    await start.update();
    const spec = start.mock.calls[0]?.[0] as { spec: Record<string, unknown> };
    expect(spec.spec).toMatchObject({
      agent: 'previous-agent',
      projectId: 'project',
      location: 'Laptop',
    });
    expect(spec.spec).not.toHaveProperty('source');
    expect(spec.spec).not.toHaveProperty('strategy');
  });

  for (const [width, height] of [
    [820, 720],
    [640, 560],
  ]) {
    it(`keeps Projects accessible and scrollable at ${width}×${height}`, async () => {
      await browser.setWindowSize(width, height);
      await $('a=Projects').click();
      await expect($('h2=Shared with the team')).toBeDisplayed();
      await browser.saveScreenshot(
        `test-results/desktop-projects-overview-${width}.png`,
      );
      await $('button=Add local location').click();
      await expect($('button=Choose folder')).toBeDisplayed();
      const audit = await new AxeBuilder({ client: browser })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        audit.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map((node) => node.target),
        })),
      ).toEqual([]);
      await $('button=Choose folder').scrollIntoView();
      await expect($('button=Choose folder')).toBeClickable();
      expect(
        await browser.execute(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await browser.saveScreenshot(
        `test-results/desktop-projects-${width}.png`,
      );
    });
  }
});
