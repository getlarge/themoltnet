import {
  formatSecretReferenceString,
  parseSecretReferenceString,
  type SecretProviderRegistry,
} from '@themoltnet/sdk';
import {
  FILE_SECRET_PROVIDER,
  type FileSecretProvider,
} from '@themoltnet/sdk/node';

import {
  AgentServerModelDiscoveryError,
  type DiscoveryFailure,
  MAX_DISCOVERED_MODELS,
  ModelDiscoveryCollector,
  parseProviderBaseUrl,
  readOllamaModalities,
} from './agent-server/model-discovery.js';
import {
  type AgentServerStore,
  assertProviderEnvName,
  assertProviderId,
  copyProviderModel,
  type ProviderEntry,
  providerEnvName,
  type ProviderModelEntry,
} from './agent-server/store.js';
import { withProviderMutationLock } from './provider-lock.js';
import { safeErrorContext } from './safe-error-context.js';

const DEFAULT_PROVIDER_API = 'openai-completions';

/**
 * Concurrent `/api/show` probes. Small on purpose: this runs against a
 * third-party endpoint on an operator's behalf, and discovery is interactive,
 * so the cap favours being a polite client over shaving a second.
 */
const MODALITY_PROBE_CONCURRENCY = 5;

export interface ProviderView {
  api: string;
  baseUrl: string;
  envName: string;
  models: ProviderModelEntry[];
  hasApiKey: boolean;
}

export interface ProviderSetInput {
  api?: string;
  baseUrl?: string;
  envName?: string;
  models?: ProviderModelEntry[];
  apiKey?: string;
  clearApiKey?: boolean;
}

export class ProviderConfigurationError extends Error {
  override name = 'ProviderConfigurationError';

  constructor(
    readonly code:
      | 'provider_not_found'
      | 'provider_secret_unavailable'
      | 'operation_aborted'
      | 'invalid_provider',
    message: string,
    readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface ProviderConfigurationLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

const silentLogger: ProviderConfigurationLogger = {
  info: () => undefined,
  warn: () => undefined,
};

export class ProviderConfigurationService {
  private readonly fetchImpl: typeof fetch;
  private readonly logger: ProviderConfigurationLogger;

  constructor(
    private readonly options: {
      store: AgentServerStore;
      secrets: FileSecretProvider;
      secretProviders: SecretProviderRegistry;
      fetchImpl?: typeof fetch;
      logger?: ProviderConfigurationLogger;
      requestTimeoutMs?: number;
    },
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger ?? silentLogger;
  }

  list(): Record<string, ProviderView> {
    return Object.fromEntries(
      Object.entries(this.options.store.readProviders()).map(
        ([id, provider]) => [id, providerView(provider)],
      ),
    );
  }

  async set(
    providerIdInput: string,
    input: ProviderSetInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<ProviderView> {
    const providerId = assertProviderId(providerIdInput);
    if (input.apiKey !== undefined && input.clearApiKey) {
      throw new ProviderConfigurationError(
        'invalid_provider',
        'apiKey and clearApiKey cannot be used together',
        400,
      );
    }
    if (input.apiKey !== undefined && input.apiKey.length === 0) {
      throw new ProviderConfigurationError(
        'invalid_provider',
        'provider API key must not be empty',
        400,
      );
    }

    return withProviderMutationLock(
      this.options.store.root,
      async () => {
        const providers = this.options.store.readProviders();
        const previous = providers[providerId];
        const baseUrl = input.baseUrl ?? previous?.baseUrl;
        if (!baseUrl) {
          throw new ProviderConfigurationError(
            'invalid_provider',
            `base URL is required when creating provider "${providerId}"`,
            400,
          );
        }
        parseProviderBaseUrl(baseUrl, providerId);
        const entry: ProviderEntry = {
          api: input.api ?? previous?.api ?? DEFAULT_PROVIDER_API,
          baseUrl,
          envName: assertProviderEnvName(
            providerId,
            input.envName ?? previous?.envName ?? providerEnvName(providerId),
          ),
          models: (input.models ?? previous?.models ?? []).map(
            copyProviderModel,
          ),
          ...(!input.clearApiKey && previous?.apiKeyRef
            ? { apiKeyRef: previous.apiKeyRef }
            : {}),
        };

        const key = `pi-provider/${providerId}`;
        let previousSecret: string | undefined;
        const previousKey = managedSecretKey(previous?.apiKeyRef);
        if (
          (input.apiKey !== undefined || input.clearApiKey) &&
          previous?.apiKeyRef
        ) {
          try {
            previousSecret = await this.options.secretProviders.resolve(
              parseSecretReferenceString(previous.apiKeyRef),
            );
          } catch (error) {
            if (input.clearApiKey) {
              throw new ProviderConfigurationError(
                'provider_secret_unavailable',
                `provider "${providerId}" API key could not be prepared for removal`,
                400,
                { cause: error },
              );
            }
            // An unavailable old value must not prevent replacing it. Rollback
            // can still restore the prior provider reference if persistence
            // fails, even when the referenced secret was already unavailable.
          }
        }
        if (input.apiKey !== undefined) {
          await this.options.secrets.write(key, input.apiKey);
          entry.apiKeyRef = formatSecretReferenceString({
            provider: FILE_SECRET_PROVIDER,
            key,
          });
        }

        if (input.clearApiKey && previousKey) {
          await this.options.secrets.delete(previousKey);
        }

        try {
          providers[providerId] = entry;
          this.options.store.writeProviders(providers);
        } catch (error) {
          try {
            if (input.apiKey !== undefined) {
              if (previousKey === key && previousSecret !== undefined) {
                await this.options.secrets.write(key, previousSecret);
              } else {
                await this.options.secrets.delete(key);
              }
            } else if (
              input.clearApiKey &&
              previousKey &&
              previousSecret !== undefined
            ) {
              await this.options.secrets.write(previousKey, previousSecret);
            }
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              'provider update failed and secret rollback was unsuccessful',
            );
          }
          throw error;
        }
        return providerView(entry);
      },
      { signal: options.signal, logger: this.logger },
    );
  }

  async remove(
    providerIdInput: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const providerId = assertProviderId(providerIdInput);
    await withProviderMutationLock(
      this.options.store.root,
      async () => {
        const providers = this.options.store.readProviders();
        const provider = providers[providerId];
        if (!provider) {
          throw new ProviderConfigurationError(
            'provider_not_found',
            `Provider ${providerId} was not found`,
            404,
          );
        }
        const key = managedSecretKey(provider.apiKeyRef);
        let previousSecret: string | undefined;
        if (provider.apiKeyRef) {
          try {
            previousSecret = await this.options.secretProviders.resolve(
              parseSecretReferenceString(provider.apiKeyRef),
            );
          } catch (error) {
            throw new ProviderConfigurationError(
              'provider_secret_unavailable',
              `provider "${providerId}" API key could not be prepared for removal`,
              400,
              { cause: error },
            );
          }
        }
        if (key) await this.options.secrets.delete(key);
        delete providers[providerId];
        try {
          this.options.store.writeProviders(providers);
        } catch (error) {
          if (key && previousSecret !== undefined) {
            try {
              await this.options.secrets.write(key, previousSecret);
            } catch (rollbackError) {
              throw new AggregateError(
                [error, rollbackError],
                'provider removal failed and secret rollback was unsuccessful',
              );
            }
          }
          throw error;
        }
      },
      { signal: options.signal, logger: this.logger },
    );
  }

  async discover(
    providerIdInput: string,
    options: { save?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ models: ProviderModelEntry[] }> {
    const providerId = assertProviderId(providerIdInput);
    const provider = this.options.store.readProviders()[providerId];
    if (!provider) {
      throw new ProviderConfigurationError(
        'provider_not_found',
        `provider "${providerId}" was not found`,
        404,
      );
    }
    const parsed = parseProviderBaseUrl(provider.baseUrl, providerId);
    const baseUrl = parsed.href.replace(/\/$/u, '');
    const apiKey = await this.resolveApiKey(providerId, provider);
    const headers: Record<string, string> = apiKey
      ? { authorization: `Bearer ${apiKey}` }
      : {};
    const failures: DiscoveryFailure[] = [];
    const collector = new ModelDiscoveryCollector();
    collector.addOpenAiResponse(
      await this.requestDiscoveryEndpoint({
        endpoint: 'openai_models',
        failures,
        headers,
        providerId,
        signal: options.signal,
        url: `${baseUrl}/models`,
      }),
    );
    if (isOllamaProvider(providerId, parsed)) {
      // Ollama Cloud exposes additional cloud-only tags through /api/tags that
      // are not guaranteed to appear in its OpenAI-compatible model list.
      collector.addOllamaResponse(
        await this.requestDiscoveryEndpoint({
          endpoint: 'ollama_tags',
          failures,
          headers,
          providerId,
          signal: options.signal,
          url: `${parsed.origin}/api/tags`,
        }),
      );
    }
    const result = collector.result(providerId, failures);
    if (result.discoveredCount > result.models.length) {
      this.logger.warn(
        {
          code: 'agent_server_provider_discovery_truncated',
          discoveredCount: result.discoveredCount,
          providerId,
          returnedCount: MAX_DISCOVERED_MODELS,
        },
        'Provider model discovery result was truncated',
      );
    }
    // Probe only what is still unknown, and only after truncation, so a
    // provider listing thousands of models cannot turn discovery into
    // thousands of requests.
    if (isOllamaProvider(providerId, parsed) && result.unresolved.length > 0) {
      await this.resolveOllamaModalities({
        collector,
        headers,
        ids: result.unresolved,
        origin: parsed.origin,
        providerId,
        signal: options.signal,
      });
    }
    // Re-read after the probes so newly learned modalities are included.
    const resolved = collector.result(providerId, failures);
    // An operator's explicit declaration outranks anything detected: marking a
    // model text-only on purpose (`--model-input <id>=text`) must survive a
    // refresh that would otherwise re-detect it as image-capable.
    const declared = new Map(
      provider.models.map((model) => [model.id, model.input]),
    );
    const models = resolved.models.map((model) => {
      const override = declared.get(model.id);
      return override && override.length > 0
        ? { id: model.id, input: [...override] }
        : model;
    });
    const detected = models.filter(
      (model) =>
        model.input?.includes('image') &&
        !declared.get(model.id)?.includes('image'),
    );
    if (detected.length > 0) {
      // Declaring a model image-capable is what allows image bytes to leave the
      // runtime for the provider, so it is named rather than done silently.
      this.logger.info(
        {
          code: 'agent_server_provider_discovery_modalities_detected',
          models: detected.map((model) => model.id),
          providerId,
        },
        'Provider models reported image input support',
      );
    }
    if (options.save) {
      await this.set(providerId, { models }, options);
    }
    this.logger.info(
      {
        code: 'agent_server_provider_discovery_completed',
        modelCount: models.length,
        providerId,
      },
      'Provider model discovery completed',
    );
    return { models };
  }

  /**
   * Fill in modalities Ollama Cloud's `/api/tags` omits, one `/api/show` per
   * still-unknown model.
   *
   * Failures here are deliberately not pushed into the discovery `failures`
   * array: that array decides the error code of a *failed* discovery, so a
   * probe rejection must not relabel an otherwise-successful one. A model whose
   * probe fails simply stays text-only.
   */
  private async resolveOllamaModalities(input: {
    collector: ModelDiscoveryCollector;
    headers: Record<string, string>;
    ids: readonly string[];
    origin: string;
    providerId: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const url = `${input.origin}/api/show`;
    for (
      let index = 0;
      index < input.ids.length;
      index += MODALITY_PROBE_CONCURRENCY
    ) {
      const batch = input.ids.slice(index, index + MODALITY_PROBE_CONCURRENCY);
      await Promise.all(
        batch.map(async (id) => {
          const body = await this.requestDiscoveryEndpoint({
            body: { model: id },
            endpoint: 'ollama_show',
            // A throwaway array: probe failures stay out of the discovery
            // failure record by construction, not by convention.
            failures: [],
            headers: input.headers,
            method: 'POST',
            providerId: input.providerId,
            signal: input.signal,
            url,
          });
          const modalities = readOllamaModalities(body);
          if (modalities) input.collector.setModalities(id, modalities);
        }),
      );
    }
  }

  private async resolveApiKey(
    providerId: string,
    provider: ProviderEntry,
  ): Promise<string | undefined> {
    if (!provider.apiKeyRef) return undefined;
    try {
      return await this.options.secretProviders.resolve(
        parseSecretReferenceString(provider.apiKeyRef),
      );
    } catch (error) {
      this.logger.warn(
        {
          ...safeErrorContext(error),
          code: 'agent_server_provider_secret_unavailable',
          providerId,
        },
        'Provider API key could not be resolved for model discovery',
      );
      throw new ProviderConfigurationError(
        'provider_secret_unavailable',
        `provider "${providerId}" API key could not be resolved`,
        400,
        { cause: error },
      );
    }
  }

  private async requestDiscoveryEndpoint(input: {
    /** JSON body, for the POST-only `/api/show` probe. */
    body?: Record<string, unknown>;
    endpoint: 'openai_models' | 'ollama_tags' | 'ollama_show';
    failures: DiscoveryFailure[];
    headers: Record<string, string>;
    method?: 'GET' | 'POST';
    providerId: string;
    signal?: AbortSignal;
    url: string;
  }): Promise<unknown> {
    const startedAt = Date.now();
    const timeout = AbortSignal.timeout(
      this.options.requestTimeoutMs ?? 10_000,
    );
    let response: Response;
    try {
      response = await this.fetchImpl(input.url, {
        ...(input.body
          ? { body: JSON.stringify(input.body), method: input.method ?? 'POST' }
          : input.method
            ? { method: input.method }
            : {}),
        headers: input.body
          ? { ...input.headers, 'content-type': 'application/json' }
          : input.headers,
        redirect: 'error',
        signal: input.signal
          ? AbortSignal.any([input.signal, timeout])
          : timeout,
      });
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      if (input.signal?.aborted) {
        const abortSource = providerAbortSource(input.signal.reason);
        this.logger.info(
          {
            abortSource,
            code: 'agent_server_provider_discovery_cancelled',
            elapsedMs,
            endpoint: input.endpoint,
            providerId: input.providerId,
          },
          'Provider model discovery was cancelled',
        );
        throw new ProviderConfigurationError(
          'operation_aborted',
          `provider "${input.providerId}" discovery was cancelled`,
          408,
          { cause: error },
        );
      }
      const errorType = error instanceof Error ? error.name : typeof error;
      input.failures.push({ kind: 'network', errorType });
      this.logger.warn(
        {
          abortSource: timeout.aborted ? 'timeout' : undefined,
          code: timeout.aborted
            ? 'agent_server_provider_discovery_timeout'
            : 'agent_server_provider_discovery_request_failed',
          elapsedMs,
          endpoint: input.endpoint,
          errorType,
          providerId: input.providerId,
        },
        timeout.aborted
          ? 'Provider model discovery request timed out'
          : 'Provider model discovery request failed',
      );
      return null;
    }
    if (!response.ok) {
      input.failures.push({ kind: 'http', status: response.status });
      const context = {
        code: 'agent_server_provider_discovery_upstream_error',
        elapsedMs: Date.now() - startedAt,
        endpoint: input.endpoint,
        providerId: input.providerId,
        statusCode: response.status,
      };
      if (
        response.status >= 500 ||
        response.status === 401 ||
        response.status === 403
      ) {
        this.logger.warn(context, 'Provider model discovery was rejected');
      } else {
        this.logger.info(
          context,
          'Provider model discovery endpoint unavailable',
        );
      }
      return null;
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      input.failures.push({ kind: 'invalid_response' });
      this.logger.warn(
        {
          code: 'agent_server_provider_discovery_invalid_json',
          elapsedMs: Date.now() - startedAt,
          endpoint: input.endpoint,
          providerId: input.providerId,
        },
        'Provider model discovery returned invalid JSON',
      );
      return null;
    }
  }
}

export function providerView(provider: ProviderEntry): ProviderView {
  return {
    api: provider.api,
    baseUrl: provider.baseUrl,
    envName: provider.envName,
    models: provider.models.map(copyProviderModel),
    hasApiKey: Boolean(provider.apiKeyRef),
  };
}

export { AgentServerModelDiscoveryError };

function isOllamaProvider(providerId: string, baseUrl: URL): boolean {
  return (
    providerId === 'ollama' ||
    providerId.startsWith('ollama-') ||
    baseUrl.hostname === 'ollama.com' ||
    baseUrl.port === '11434'
  );
}

function managedSecretKey(reference?: string): string | undefined {
  if (!reference) return undefined;
  try {
    const parsed = parseSecretReferenceString(reference);
    return parsed.provider === FILE_SECRET_PROVIDER ? parsed.key : undefined;
  } catch {
    return undefined;
  }
}

function providerAbortSource(reason: unknown): 'caller' | 'shutdown' {
  if (
    typeof reason === 'object' &&
    reason !== null &&
    'source' in reason &&
    reason.source === 'shutdown'
  ) {
    return 'shutdown';
  }
  return 'caller';
}
