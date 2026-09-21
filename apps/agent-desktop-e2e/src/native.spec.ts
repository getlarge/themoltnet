import type { DesktopStatus } from '@moltnet/agent-desktop/bridge';
import { browser, expect } from '@wdio/globals';

describe('Native Desktop with an isolated installation', () => {
  it('reads the real supervised lifecycle without launching work', async () => {
    await browser.waitUntil(
      async () => {
        const status = await browser.tauri.execute<Promise<DesktopStatus>, []>(
          ({ core }) => core.invoke('desktop_status') as Promise<DesktopStatus>,
        );
        return status.state === 'running';
      },
      { timeout: 30_000, timeoutMsg: 'Supervised daemon did not become ready' },
    );
    const status = await browser.tauri.execute<Promise<DesktopStatus>, []>(
      ({ core }) => core.invoke('desktop_status') as Promise<DesktopStatus>,
    );
    expect(status.installedVersion).not.toBeNull();
  });
});

describe('Native Desktop and real fixture daemon', () => {
  it('starts, persists a provider, stops, and reads it after restart', async () => {
    const started = await browser.tauri.execute<Promise<DesktopStatus>, []>(
      ({ core }) => core.invoke('start_agent_server') as Promise<DesktopStatus>,
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
