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

function fixture(
  options: {
    fetchImpl?: typeof fetch;
    logger?: {
      info: ReturnType<typeof vi.fn>;
      warn: ReturnType<typeof vi.fn>;
    };
    requestTimeoutMs?: number;
  } = {},
) {
  const temp = mkdtempSync(join(tmpdir(), 'provider-configuration-'));
  cleanups.push(() => rmSync(temp, { recursive: true, force: true }));
  const store = new AgentServerStore(join(temp, 'moltnet')).ensure();
  const secrets = new FileSecretProvider({
    root: store.secretsDir,
    writable: true,
  });
  const secretProviders = new SecretProviderRegistry().register(secrets);
  return {
    secretProviders,
    store,
    secrets,
    service: new ProviderConfigurationService({
      store,
      secrets,
      secretProviders,
      ...options,
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

  it('replaces an API key when the previous referenced secret is unavailable', async () => {
    const { service, secretProviders, secrets, store } = fixture();
    await service.set('remote', {
      baseUrl: 'https://provider.example/v1',
      apiKey: 'old-secret',
    });
    await secrets.delete('pi-provider/remote');

    await expect(
      service.set('remote', { apiKey: 'replacement-secret' }),
    ).resolves.toMatchObject({ hasApiKey: true });
    await expect(
      secretProviders.resolve({
        provider: 'file',
        key: 'pi-provider/remote',
      }),
    ).resolves.toBe('replacement-secret');
    expect(store.readProviders()['remote']?.apiKeyRef).toBe(
      'file:pi-provider/remote',
    );
  });

  it('restores the previous secret when provider persistence fails', async () => {
    const { service, secretProviders, store } = fixture();
    await service.set('remote', {
      baseUrl: 'https://provider.example/v1',
      apiKey: 'old-secret',
      models: ['old-model'],
    });
    vi.spyOn(store, 'writeProviders').mockImplementationOnce(() => {
      throw new Error('persistence failed');
    });

    await expect(
      service.set('remote', {
        apiKey: 'replacement-secret',
        models: ['new-model'],
      }),
    ).rejects.toThrow('persistence failed');

    expect(store.readProviders()['remote']?.models).toEqual(['old-model']);
    await expect(
      secretProviders.resolve({
        provider: 'file',
        key: 'pi-provider/remote',
      }),
    ).resolves.toBe('old-secret');
  });

  it('keeps provider metadata when secret deletion fails', async () => {
    const { service, secrets, store } = fixture();
    await service.set('remote', {
      baseUrl: 'https://provider.example/v1',
      apiKey: 'kept-secret',
    });
    vi.spyOn(secrets, 'delete').mockRejectedValueOnce(
      new Error('secret store unavailable'),
    );

    await expect(service.remove('remote')).rejects.toThrow(
      'secret store unavailable',
    );

    expect(store.readProviders()['remote']?.apiKeyRef).toBe(
      'file:pi-provider/remote',
    );
  });

  it('restores a deleted secret when provider removal persistence fails', async () => {
    const { service, secretProviders, store } = fixture();
    await service.set('remote', {
      baseUrl: 'https://provider.example/v1',
      apiKey: 'restored-secret',
    });
    vi.spyOn(store, 'writeProviders').mockImplementationOnce(() => {
      throw new Error('persistence failed');
    });

    await expect(service.remove('remote')).rejects.toThrow(
      'persistence failed',
    );

    expect(store.readProviders()['remote']?.apiKeyRef).toBe(
      'file:pi-provider/remote',
    );
    await expect(
      secretProviders.resolve({
        provider: 'file',
        key: 'pi-provider/remote',
      }),
    ).resolves.toBe('restored-secret');
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
    const { service } = fixture({ fetchImpl });
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
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(service.list()['ollama-cloud']).toMatchObject({
      api: 'openai-responses',
      baseUrl: 'https://ollama.com/v1',
      hasApiKey: true,
      models: ['gemma4:31b-cloud', 'local', 'shared'],
    });
  });

  it('does not query Ollama tags for an unrelated provider', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'remote-model' }] })),
      ),
    );
    const { service } = fixture({ fetchImpl });
    await service.set('remote', {
      baseUrl: 'https://provider.example/v1',
    });

    await expect(service.discover('remote')).resolves.toEqual({
      models: ['remote-model'],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://provider.example/v1/models',
      expect.any(Object),
    );
  });

  it('keeps the request timeout when a caller supplies a cancellation signal', async () => {
    const caller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      const signal = init?.signal;
      expect(signal).not.toBe(caller.signal);
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(new Error('request aborted', { cause: signal.reason })),
          { once: true },
        );
      });
    });
    const { service } = fixture({ fetchImpl, requestTimeoutMs: 5 });
    await service.set('remote', {
      baseUrl: 'https://provider.example/v1',
    });

    await expect(
      service.discover('remote', { signal: caller.signal }),
    ).rejects.toMatchObject({ name: 'AgentServerModelDiscoveryError' });
    expect(caller.signal.aborted).toBe(false);
  });

  it('cancels discovery promptly from the caller signal', async () => {
    const caller = new AbortController();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            reject(new Error('cancelled'));
          },
          { once: true },
        );
      });
    });
    const { service } = fixture({
      fetchImpl,
      logger,
      requestTimeoutMs: 60_000,
    });
    await service.set('remote', {
      baseUrl: 'https://provider.example/v1',
    });

    const discovering = service.discover('remote', {
      signal: caller.signal,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    caller.abort(new Error('operator cancelled'));

    await expect(discovering).rejects.toMatchObject({
      code: 'operation_aborted',
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSource: 'caller',
        code: 'agent_server_provider_discovery_cancelled',
        providerId: 'remote',
      }),
      'Provider model discovery was cancelled',
    );
  });

  it('warns for rejected discovery responses with safe error context', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 401 })),
    );
    const { service } = fixture({ fetchImpl, logger });
    await service.set('remote', {
      baseUrl: 'https://provider.example/v1',
    });

    await expect(service.discover('remote')).rejects.toMatchObject({
      name: 'AgentServerModelDiscoveryError',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'agent_server_provider_discovery_upstream_error',
        statusCode: 401,
      }),
      'Provider model discovery was rejected',
    );
  });
});
