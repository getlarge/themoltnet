import { readFileSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { DesktopStatus } from '@moltnet/agent-desktop/bridge';
import { $, browser, expect } from '@wdio/globals';

import { expectNoAxeViolations, preset, WINDOW_SIZES } from './run-fixtures.js';

// Native refresh and explicit operations intentionally share a nonblocking lock.
// Retry only a rejected operation that has not acquired the lock or mutated state.
async function lifecycle(command: string): Promise<DesktopStatus> {
  let result: DesktopStatus | undefined;
  let failure: unknown;
  await browser.waitUntil(
    async () => {
      try {
        result = await browser.tauri.execute<Promise<DesktopStatus>, [string]>(
          ({ core }, name) => core.invoke(name) as Promise<DesktopStatus>,
          command,
        );
        return true;
      } catch (error) {
        if (
          String(error).includes(
            'another desktop lifecycle operation is already in progress',
          )
        )
          return false;
        failure = error;
        return true;
      }
    },
    {
      timeout: 30_000,
      interval: 200,
      timeoutMsg: `Lifecycle lock did not become available for ${command}`,
    },
  );
  if (failure !== undefined)
    throw failure instanceof Error ? failure : new Error(String(failure));
  if (!result) throw new Error(`No lifecycle result for ${command}`);
  return result;
}

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
    const saved = await browser.tauri.execute(({ core }) =>
      core.invoke('desktop_put_provider', {
        providerId: 'ollama',
        config: {
          api: 'openai-completions',
          envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
          baseUrl: 'http://127.0.0.1:11434',
          models: [{ id: 'fixture-model' }],
        },
      }),
    );
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

// Rendered acceptance uses the actual WebKit window and native bridge, including
// the stopped-daemon recovery state. Tray behavior remains a separate OS check.
describe('Native window accessibility', () => {
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
      await browser.tauri.execute(({ core }) => core.invoke('desktop_e2e_tab'));
      await expect($('button=Delete preset')).toBeFocused();
      await browser.waitUntil(
        async () =>
          browser.execute(() => {
            // Background WebKit pauses animation time. Capture the actual
            // focus state's final style without depending on foreground policy.
            document.getAnimations().forEach((animation) => animation.finish());
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
      await browser.saveScreenshot(`test-results/desktop-native-${width}.png`);
      await $('a=Providers').click();
      await $('button=Return to run draft').click();
      await expect($('button=Delete preset')).toBeFocused();
      await $('button=Cancel').click();
    });
  }
});
