import { readFileSync } from 'node:fs';

import type { DesktopStatus } from '@moltnet/agent-desktop/bridge';
import { browser, expect } from '@wdio/globals';

const installedVersion = readFileSync(
  new URL('../../agent-desktop/agent-cli.version', import.meta.url),
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
  it('reads the real supervised lifecycle without launching work', async () => {
    const status = await browser.tauri.execute<Promise<DesktopStatus>, []>(
      ({ core }) => core.invoke('desktop_status') as Promise<DesktopStatus>,
    );
    expect(status.installedVersion).toBe(installedVersion);
  });
});

describe('Native Desktop and real fixture daemon', () => {
  it('starts, persists a provider, stops, and reads it after restart', async () => {
    const started = await browser.tauri.execute<Promise<DesktopStatus>, []>(
      ({ core }) => core.invoke('start_agent_server') as Promise<DesktopStatus>,
    );
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
    const stopped = await browser.tauri.execute<Promise<DesktopStatus>, []>(
      ({ core }) => core.invoke('stop_agent_server') as Promise<DesktopStatus>,
    );
    expect(stopped.state).toBe('stopped');
    const restarted = await browser.tauri.execute<Promise<DesktopStatus>, []>(
      ({ core }) => core.invoke('start_agent_server') as Promise<DesktopStatus>,
    );
    expect(restarted.state).toBe('running');
    const providers = await browser.tauri.execute(({ core }) =>
      core.invoke('desktop_providers'),
    );
    expect(providers).toEqual(expect.objectContaining({ ollama: saved }));
    await browser.tauri.execute(({ core }) => core.invoke('stop_agent_server'));
  });
});
