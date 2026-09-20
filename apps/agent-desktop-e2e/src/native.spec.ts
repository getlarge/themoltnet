import { readFileSync } from 'node:fs';

import { $, browser, expect } from '@wdio/globals';

import type { DesktopStatus } from '@moltnet/agent-desktop/bridge';
import { preset } from './run-fixtures.js';

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
  if (failure !== undefined) throw failure;
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
