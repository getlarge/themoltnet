import { readFileSync, realpathSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { DesktopStatus } from '@moltnet/agent-desktop/bridge';
import { $, browser, expect } from '@wdio/globals';

import { lifecycle } from './journey-helpers.js';
import { selectNative } from './native-input.js';
import { expectNoAxeViolations, preset, WINDOW_SIZES } from './run-fixtures.js';

const installedVersion = readFileSync(
  new URL('../../agent-desktop/agent-cli.minimum-version', import.meta.url),
  'utf8',
).trim();

beforeEach(async () => {
  await browser.waitUntil(
    async () => {
      const status = await browser.tauri.execute<Promise<DesktopStatus>, []>(
        ({ core }) => core.invoke('desktop_status') as Promise<DesktopStatus>,
      );
      if (status.state === 'stopped') {
        const started = await browser.tauri.execute<Promise<DesktopStatus>, []>(
          ({ core }) =>
            core.invoke('start_agent_server') as Promise<DesktopStatus>,
        );
        return started.state === 'running';
      }
      return status.state === 'running';
    },
    { timeout: 30_000, timeoutMsg: 'Supervised daemon did not become ready' },
  );
});

describe('Native Desktop with an isolated installation', () => {
  it('reads the supervised lifecycle and resolves presets while stopped', async () => {
    const status = await browser.tauri.execute<Promise<DesktopStatus>, []>(
      ({ core }) => core.invoke('desktop_status') as Promise<DesktopStatus>,
    );
    expect(status.installedVersion).toBe(installedVersion);
    await lifecycle('stop_agent_server');
    const scope = await browser.tauri.execute<
      Promise<{ storageScope: string }>,
      []
    >(
      ({ core }) =>
        core.invoke('desktop_preset_storage_scope') as Promise<{
          storageScope: string;
        }>,
    );
    expect(scope.storageScope).toBe(process.env.MOLTNET_HOME);
    await browser.execute(
      (namespace, saved) => {
        localStorage.setItem(
          `moltnet.run-presets.v1:${namespace}`,
          JSON.stringify([saved]),
        );
      },
      scope.storageScope,
      preset,
    );
  });
});

describe('Native Desktop and real fixture daemon', () => {
  it('starts, persists a provider, stops, and reads it after restart', async () => {
    const started = await lifecycle('start_agent_server');
    expect(started.state).toBe('running');
    const saved = await lifecycle('desktop_put_provider', {
      providerId: 'ollama',
      config: {
        api: 'openai-completions',
        envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
        baseUrl: 'http://127.0.0.1:11434',
        models: [{ id: 'fixture-model' }],
      },
    });
    expect(saved).toEqual(
      expect.objectContaining({
        api: 'openai-completions',
        baseUrl: 'http://127.0.0.1:11434',
        models: [expect.objectContaining({ id: 'fixture-model' })],
      }),
    );
    const stopped = await lifecycle('stop_agent_server');
    expect(stopped.state).toBe('stopped');
    await expect($('a=Saved worker')).toBeDisplayed();
    const restarted = await lifecycle('start_agent_server');
    expect(restarted.state).toBe('running');
    const providers = await browser.tauri.execute(({ core }) =>
      core.invoke('desktop_providers'),
    );
    expect(providers).toEqual(expect.objectContaining({ ollama: saved }));
    await lifecycle('stop_agent_server');
  });
});

describe('Native project locations', () => {
  it('persists a location through real native commands and removes registration only', async () => {
    const root = process.env.MOLTNET_DESKTOP_E2E_FIXTURE_ROOT;
    if (!root) throw new Error('Missing isolated fixture root');
    const source = join(root, 'project-checkout');
    await mkdir(source);
    await lifecycle('start_agent_server');
    const initial = await browser.tauri.execute(({ core }) =>
      core.invoke('desktop_project_locations'),
    );
    expect(initial).toEqual({ locations: [] });
    const location = {
      identity: 'desktop-fixture',
      name: 'Laptop',
      teamId: 'team',
      projectId: 'project',
      source,
      strategy: 'existing',
      default: true,
    };
    const saved = await browser.tauri.execute(
      ({ core }, input) =>
        core.invoke('desktop_save_project_location', { input }),
      location,
    );
    expect(saved).toMatchObject({ name: 'Laptop', readiness: { ready: true } });
    await lifecycle('stop_agent_server');
    await lifecycle('start_agent_server');
    const persisted = await browser.tauri.execute(({ core }) =>
      core.invoke('desktop_project_locations'),
    );
    expect(persisted).toMatchObject({ locations: [{ name: 'Laptop' }] });
    await browser.tauri.execute(({ core }) =>
      core.invoke('desktop_remove_project_location', { name: 'Laptop' }),
    );
    expect((await stat(source)).isDirectory()).toBe(true);
    await lifecycle('stop_agent_server');
  });
});

describe('Native managed project execution', () => {
  it('launches a captured location through the real daemon and isolated worker', async () => {
    const root = process.env.MOLTNET_DESKTOP_E2E_FIXTURE_ROOT;
    if (!root) throw new Error('Missing isolated fixture root');
    const source = join(root, 'run-checkout');
    await mkdir(source);
    await lifecycle('start_agent_server');
    await browser.tauri.execute(
      ({ core }, input) =>
        core.invoke('desktop_save_project_location', { input }),
      {
        identity: 'desktop-fixture',
        name: 'Run location',
        teamId: 'team',
        projectId: 'project',
        source,
        strategy: 'existing',
        default: true,
      },
    );
    const run = await browser.tauri.execute<
      Promise<{ id: string; workspace: { source: string; projectId: string } }>,
      []
    >(
      ({ core }) =>
        core.invoke('desktop_start_run', {
          spec: {
            agent: 'desktop-fixture',
            teamId: 'team',
            projectId: 'project',
            location: 'Run location',
            profiles: ['fixture-profile'],
            taskTypes: ['freeform'],
            mode: 'poll',
          },
        }) as Promise<{
          id: string;
          workspace: { source: string; projectId: string };
        }>,
    );
    // The daemon records the canonical folder (/var → /private/var on macOS).
    expect(run.workspace).toMatchObject({
      projectId: 'project',
      source: realpathSync(source),
    });
    await browser.waitUntil(
      async () => {
        const logs = await browser.tauri.execute(
          ({ core }, runId) => core.invoke('desktop_run_logs', { runId }),
          run.id,
        );
        return JSON.stringify(logs).includes('fixture-worker-ready');
      },
      { timeout: 15_000 },
    );
    const workerLog = await browser.tauri.execute<
      Promise<{ lines: string[] }>,
      [string]
    >(
      ({ core }, runId) =>
        core.invoke('desktop_run_logs', { runId }) as Promise<{
          lines: string[];
        }>,
      run.id,
    );
    const readyLine = workerLog.lines.find((line) =>
      line.includes('fixture-worker-ready'),
    );
    expect(readyLine).toBeDefined();
    expect(JSON.parse(readyLine ?? '{}')).toMatchObject({
      projectId: 'project',
      source,
      strategy: 'existing',
    });
    await browser.tauri.execute(
      ({ core }, runId) => core.invoke('desktop_stop_run', { runId }),
      run.id,
    );
    await lifecycle('stop_agent_server');
  });
});

// Rendered acceptance uses the actual WebKit window and native bridge, including
// the stopped-daemon recovery state. Tray behavior remains a separate OS check.
(process.platform === 'darwin' ? describe : describe.skip)(
  'Native window accessibility',
  () => {
    for (const [width, height] of WINDOW_SIZES) {
      it(`supports keyboard recovery and scrolling at ${width}×${height}`, async () => {
        await browser.setWindowSize(width, height);
        await $('a=Saved worker').click();
        await expect($('button=Retry catalogue')).toBeDisplayed();
        // The native app has one webview; axe must not open a browser tab.
        await expectNoAxeViolations(true);
        const name = $(
          '//label[normalize-space()="Preset name"]/following-sibling::input',
        );
        await browser.execute(
          (element) => {
            (element as unknown as HTMLElement).scrollIntoView({
              block: 'center',
              behavior: 'instant',
            });
          },
          await name.getElement(),
        );
        await name.click();
        await browser.tauri.execute(({ core }) =>
          core.invoke('desktop_e2e_tab'),
        );
        await expect($('button=Delete preset')).toBeFocused();
        await browser.waitUntil(
          async () =>
            browser.execute(() => {
              // Background WebKit pauses animation time. Capture the actual
              // focus state's final style without depending on foreground policy.
              document
                .getAnimations()
                .forEach((animation) => animation.finish());
              const focused = document.activeElement;
              return Boolean(
                focused &&
                // Both themes draw the same four-pixel outer ring.
                getComputedStyle(focused).boxShadow.includes('4px'),
              );
            }),
          {
            timeout: 2000,
            timeoutMsg: 'Keyboard focus must have a visible ring',
          },
        );
        await expect($('button=Start run')).toBeDisabled();
        expect(
          await browser.execute(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await browser.saveScreenshot(
          `test-results/desktop-native-${width}.png`,
        );
        // Partial text: the link carries a badge when provider keys are missing.
        await $('a*=Providers').click();
        await $('button=Return to run draft').click();
        await expect($('button=Delete preset')).toBeFocused();
        await $('button=Cancel').click();
      });
    }
  },
);

describe('Native Projects screen', () => {
  afterEach(async function () {
    if (this.currentTest?.state === 'failed')
      console.error(await browser.execute(() => document.body.innerText));
  });
  it('explicitly saves and removes a local registration through the rendered interface', async () => {
    await lifecycle('start_agent_server');
    await $('a=Projects').click();
    await expect($('h2=Shared with the team')).toBeDisplayed({ wait: 15000 });
    await $('button=Add local location').click();
    await $(
      '//label[normalize-space()="Location name"]/following-sibling::input',
    ).setValue('Native UI location');
    await selectNative(
      $(
        '//label[normalize-space()="Workspace default"]/following-sibling::select',
      ),
      'none',
    );
    await browser.execute(() =>
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === 'Save location')
        ?.scrollIntoView({ behavior: 'instant', block: 'center' }),
    );
    await $('button=Save location').click();
    await expect($('h3=Native UI location')).toBeDisplayed();
    const persisted = await browser.tauri.execute(({ core }) =>
      core.invoke('desktop_project_locations'),
    );
    expect(persisted).toMatchObject({
      locations: expect.arrayContaining([
        expect.objectContaining({
          name: 'Native UI location',
          strategy: 'none',
        }),
      ]),
    });
    for (const [width, height] of WINDOW_SIZES) {
      await browser.setWindowSize(width, height);
      await browser.execute(() => {
        for (const animation of document.getAnimations()) {
          if (animation.effect?.getComputedTiming().iterations !== Infinity)
            animation.finish();
        }
      });
      await expectNoAxeViolations(true);
      expect(
        await browser.execute(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await browser.saveScreenshot(
        `test-results/desktop-native-projects-${width}.png`,
      );
    }
    const remove = $('button[aria-label="Remove Native UI location"]');
    await browser.execute(() =>
      document
        .querySelector('button[aria-label="Remove Native UI location"]')
        ?.scrollIntoView({ behavior: 'instant' }),
    );
    await remove.click();
    await expect($('h3=Native UI location')).not.toExist();
    await lifecycle('stop_agent_server');
  });
});
