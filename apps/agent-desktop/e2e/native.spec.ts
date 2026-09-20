import { browser, expect } from '@wdio/globals';

import type { DesktopStatus } from '../src/bridge.js';

describe('Native Desktop with an isolated installation awaiting trust', () => {
  it('reads real lifecycle state without installing or starting a daemon', async () => {
    await browser.waitUntil(async () => {
      const status = await browser.tauri.execute<Promise<DesktopStatus>, []>(
        ({ core }) => core.invoke('desktop_status') as Promise<DesktopStatus>,
      );
      return status.state === 'needs_trust';
    });
    const status = await browser.tauri.execute<Promise<DesktopStatus>, []>(
      ({ core }) => core.invoke('desktop_status') as Promise<DesktopStatus>,
    );
    expect(status.installedVersion).not.toBeNull();
    expect(status.trusted).toBe(false);
  });
});

describe('Native Desktop and real fixture daemon', () => {
  it('starts, persists a provider, stops, and reads it after restart', async () => {
    const started = await browser.tauri.execute<Promise<DesktopStatus>, []>(
      ({ core }) =>
        core.invoke('approve_local_trust') as Promise<DesktopStatus>,
    );
    expect(started.state).toBe('running');
    await browser.tauri.execute(({ core }) =>
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
    expect(JSON.stringify(providers)).toContain('fixture-model');
    await browser.tauri.execute(({ core }) => core.invoke('stop_agent_server'));
  });
});
