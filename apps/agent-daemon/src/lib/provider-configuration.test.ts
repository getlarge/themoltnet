import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SecretProviderRegistry } from '@themoltnet/sdk';
import { FileSecretProvider } from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentServerStore } from './agent-server/store.js';
import { ProviderConfigurationService } from './provider-configuration.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture(fetchImpl?: typeof fetch) {
  const temp = mkdtempSync(join(tmpdir(), 'provider-configuration-'));
  cleanups.push(() => rmSync(temp, { recursive: true, force: true }));
  const store = new AgentServerStore(join(temp, 'moltnet')).ensure();
  const secrets = new FileSecretProvider({
    root: store.secretsDir,
    writable: true,
  });
  const secretProviders = new SecretProviderRegistry().register(secrets);
  return {
    store,
    secrets,
    service: new ProviderConfigurationService({
      store,
      secrets,
      secretProviders,
      ...(fetchImpl ? { fetchImpl } : {}),
    }),
  };
}

describe('ProviderConfigurationService', () => {
  it('preserves omitted fields and can remove only the stored API key', async () => {
    const { service, store } = fixture();
    await service.set('ollama-cloud', {
      baseUrl: 'https://ollama.com/v1',
      apiKey: 'secret-value',
      models: ['old-model'],
    });

    await expect(
      service.set('ollama-cloud', { models: ['new-model'] }),
    ).resolves.toMatchObject({
      api: 'openai-completions',
      baseUrl: 'https://ollama.com/v1',
      models: ['new-model'],
      hasApiKey: true,
    });
    await expect(
      service.set('ollama-cloud', { clearApiKey: true }),
    ).resolves.toMatchObject({ hasApiKey: false });
    expect(store.readProviders()['ollama-cloud']?.apiKeyRef).toBeUndefined();
    expect(
      readFileSync(join(store.root, 'providers.json'), 'utf8'),
    ).not.toContain('secret-value');
  });

  it('serializes mutations across service instances', async () => {
    const { store, secrets } = fixture();
    const secretProviders = new SecretProviderRegistry().register(secrets);
    const first = new ProviderConfigurationService({
      store,
      secrets,
      secretProviders,
    });
    const second = new ProviderConfigurationService({
      store,
      secrets,
      secretProviders,
    });

    await Promise.all([
      first.set('first', { baseUrl: 'https://first.example/v1' }),
      second.set('second', { baseUrl: 'https://second.example/v1' }),
    ]);

    expect(Object.keys(store.readProviders()).sort()).toEqual([
      'first',
      'second',
    ]);
  });

  it('merges OpenAI and Ollama discovery and saves only the model patch', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      return url.endsWith('/api/tags')
        ? new Response(
            JSON.stringify({
              models: [{ name: 'gemma4:31b-cloud' }, { name: 'shared' }],
            }),
          )
        : new Response(
            JSON.stringify({ data: [{ id: 'shared' }, { id: 'local' }] }),
          );
    });
    const { service } = fixture(fetchImpl);
    await service.set('ollama-cloud', {
      api: 'openai-responses',
      baseUrl: 'https://ollama.com/v1',
      apiKey: 'kept',
      models: ['stale'],
    });

    await expect(
      service.discover('ollama-cloud', { save: true }),
    ).resolves.toEqual({
      models: ['gemma4:31b-cloud', 'local', 'shared'],
    });
    expect(service.list()['ollama-cloud']).toMatchObject({
      api: 'openai-responses',
      baseUrl: 'https://ollama.com/v1',
      hasApiKey: true,
      models: ['gemma4:31b-cloud', 'local', 'shared'],
    });
  });
});
