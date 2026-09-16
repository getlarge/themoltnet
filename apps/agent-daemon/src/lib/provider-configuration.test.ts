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

/**
 * Route a discovery fetch by endpoint. Every discovery test needs the same
 * three-way split, so adding an endpoint is a change here rather than in each
 * fixture. An omitted handler answers with an empty body of the right shape.
 */
function discoveryFetch(routes: {
  models?: unknown;
  tags?: unknown;
  show?: unknown | ((model: string) => unknown);
}): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/show')) {
      const model = String(
        (JSON.parse(String(init?.body ?? '{}')) as { model?: string }).model ??
          '',
      );
      const show =
        typeof routes.show === 'function'
          ? (routes.show as (model: string) => unknown)(model)
          : routes.show;
      return new Response(JSON.stringify(show ?? {}));
    }
    if (url.endsWith('/api/tags')) {
      return new Response(JSON.stringify(routes.tags ?? { models: [] }));
    }
    return new Response(JSON.stringify(routes.models ?? { data: [] }));
  });
}

describe('ProviderConfigurationService', () => {
  it('preserves omitted fields and can remove only the stored API key', async () => {
    const { service, store } = fixture();
    await service.set('ollama-cloud', {
      baseUrl: 'https://ollama.com/v1',
      apiKey: 'secret-value',
      models: [{ id: 'old-model' }],
    });

    await expect(
      service.set('ollama-cloud', { models: [{ id: 'new-model' }] }),
    ).resolves.toMatchObject({
      api: 'openai-completions',
      baseUrl: 'https://ollama.com/v1',
      models: [{ id: 'new-model' }],
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
      models: [{ id: 'old-model' }],
    });
    vi.spyOn(store, 'writeProviders').mockImplementationOnce(() => {
      throw new Error('persistence failed');
    });

    await expect(
      service.set('remote', {
        apiKey: 'replacement-secret',
        models: [{ id: 'new-model' }],
      }),
    ).rejects.toThrow('persistence failed');

    expect(store.readProviders()['remote']?.models).toEqual([
      { id: 'old-model' },
    ]);
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

  it('keeps declared input modalities across a discovery refresh', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (input) =>
        new Response(
          String(input).endsWith('/api/tags')
            ? JSON.stringify({ models: [] })
            : JSON.stringify({
                data: [{ id: 'qwen3.5:397b-cloud' }, { id: 'glm-5.2:cloud' }],
              }),
        ),
    );
    const { service } = fixture({ fetchImpl });
    await service.set('ollama-cloud', {
      baseUrl: 'https://ollama.com/v1',
      models: [
        { id: 'qwen3.5:397b-cloud', input: ['text', 'image'] },
        { id: 'glm-5.2:cloud' },
      ],
    });

    await service.discover('ollama-cloud', { save: true });

    // Discovery reports ids only; a refresh must not demote a declared
    // vision model back to text-only.
    expect(service.list()['ollama-cloud']?.models).toEqual([
      { id: 'glm-5.2:cloud' },
      { id: 'qwen3.5:397b-cloud', input: ['text', 'image'] },
    ]);
  });

  it('marks a model image-capable when Ollama reports vision', async () => {
    const fetchImpl = discoveryFetch({
      models: { data: [{ id: 'qwen3.5:397b' }] },
      show: { capabilities: ['completion', 'tools', 'vision'] },
    });
    const { service } = fixture({ fetchImpl });
    await service.set('ollama-cloud', { baseUrl: 'https://ollama.com/v1' });

    await service.discover('ollama-cloud', { save: true });

    expect(service.list()['ollama-cloud']?.models).toEqual([
      { id: 'qwen3.5:397b', input: ['text', 'image'] },
    ]);
  });

  it('leaves a model text-only when Ollama reports no vision', async () => {
    const fetchImpl = discoveryFetch({
      models: { data: [{ id: 'glm-5.2' }] },
      show: { capabilities: ['completion'] },
    });
    const { service } = fixture({ fetchImpl });
    await service.set('ollama-cloud', { baseUrl: 'https://ollama.com/v1' });

    await service.discover('ollama-cloud', { save: true });

    expect(service.list()['ollama-cloud']?.models).toEqual([{ id: 'glm-5.2' }]);
  });

  it('still succeeds when a capability probe fails, leaving the model text-only', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/show')) {
        return new Response('nope', { status: 500 });
      }
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [] }));
      }
      return new Response(JSON.stringify({ data: [{ id: 'qwen3.5:397b' }] }));
    });
    const { service } = fixture({ fetchImpl });
    await service.set('ollama-cloud', { baseUrl: 'https://ollama.com/v1' });

    // A probe failure is not a discovery failure: the ids were found, so the
    // call resolves and the unprobed model simply stays text-only.
    await expect(
      service.discover('ollama-cloud', { save: true }),
    ).resolves.toEqual({ models: [{ id: 'qwen3.5:397b' }] });
    expect(service.list()['ollama-cloud']?.models).toEqual([
      { id: 'qwen3.5:397b' },
    ]);
  });

  it('lets an explicit text-only declaration outrank a detected capability', async () => {
    const fetchImpl = discoveryFetch({
      models: { data: [{ id: 'qwen3.5:397b' }] },
      show: { capabilities: ['vision'] },
    });
    const { service } = fixture({ fetchImpl });
    await service.set('ollama-cloud', {
      baseUrl: 'https://ollama.com/v1',
      // Pinned to text on purpose; auto-detection must not quietly re-enable
      // image egress on the next refresh.
      models: [{ id: 'qwen3.5:397b', input: ['text'] }],
    });

    await service.discover('ollama-cloud', { save: true });

    expect(service.list()['ollama-cloud']?.models).toEqual([
      { id: 'qwen3.5:397b', input: ['text'] },
    ]);
  });

  it('probes every unresolved model without exceeding the concurrency cap', async () => {
    const ids = Array.from({ length: 12 }, (_value, index) => `m-${index}`);
    let inFlight = 0;
    let peakInFlight = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [] }));
      }
      if (!url.endsWith('/api/show')) {
        return new Response(
          JSON.stringify({ data: ids.map((id) => ({ id })) }),
        );
      }
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      // Yield on a microtask, not a timer: Promise.all invokes a whole batch
      // synchronously before any of them resume, so the observed peak is
      // deterministic rather than a race against the event loop.
      await Promise.resolve();
      inFlight -= 1;
      return new Response(JSON.stringify({ capabilities: ['vision'] }));
    });
    const { service } = fixture({ fetchImpl });
    await service.set('ollama-cloud', { baseUrl: 'https://ollama.com/v1' });

    const result = await service.discover('ollama-cloud', { save: true });

    const probes = fetchImpl.mock.calls.filter(([url]) =>
      String(url).endsWith('/api/show'),
    );
    // Every unknown id is asked about exactly once...
    expect(probes).toHaveLength(ids.length);
    // ...and the cap bounds parallelism exactly: a regression to serial would
    // read 1, and an unbounded fan-out would read 12.
    expect(peakInFlight).toBe(5);
    expect(result.models.every((model) => model.input?.includes('image'))).toBe(
      true,
    );
  });

  it('merges OpenAI and Ollama discovery and saves only the model patch', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        // Shape a local Ollama returns: capabilities inline, no probe needed.
        return new Response(
          JSON.stringify({
            models: [
              {
                name: 'gemma4:31b-cloud',
                capabilities: ['completion', 'vision'],
              },
              { name: 'shared', capabilities: ['completion'] },
            ],
          }),
        );
      }
      if (url.endsWith('/api/show')) {
        return new Response(JSON.stringify({ capabilities: ['completion'] }));
      }
      return new Response(
        JSON.stringify({ data: [{ id: 'shared' }, { id: 'local' }] }),
      );
    });
    const { service } = fixture({ fetchImpl });
    await service.set('ollama-cloud', {
      api: 'openai-responses',
      baseUrl: 'https://ollama.com/v1',
      apiKey: 'kept',
      models: [{ id: 'stale' }],
    });

    await expect(
      service.discover('ollama-cloud', { save: true }),
    ).resolves.toEqual({
      models: [
        { id: 'gemma4:31b-cloud', input: ['text', 'image'] },
        { id: 'local' },
        { id: 'shared' },
      ],
    });
    // /v1/models + /api/tags + one /api/show for `local`, the only id the tags
    // response did not describe. The two it did describe are not re-fetched.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(service.list()['ollama-cloud']).toMatchObject({
      api: 'openai-responses',
      baseUrl: 'https://ollama.com/v1',
      hasApiKey: true,
      models: [
        { id: 'gemma4:31b-cloud', input: ['text', 'image'] },
        { id: 'local' },
        { id: 'shared' },
      ],
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
      models: [{ id: 'remote-model' }],
    });
    // A non-Ollama provider must not be probed: one call, no /api/show.
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
