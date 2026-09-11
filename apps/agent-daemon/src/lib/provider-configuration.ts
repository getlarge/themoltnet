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
} from './agent-server/model-discovery.js';
import {
  type AgentServerStore,
  assertProviderEnvName,
  assertProviderId,
  type ProviderEntry,
  providerEnvName,
} from './agent-server/store.js';
import { withProviderMutationLock } from './provider-lock.js';

const DEFAULT_PROVIDER_API = 'openai-completions';

export interface ProviderView {
  api: string;
  baseUrl: string;
  envName: string;
  models: string[];
  hasApiKey: boolean;
}

export interface ProviderSetInput {
  api?: string;
  baseUrl?: string;
  envName?: string;
  models?: string[];
  apiKey?: string;
  clearApiKey?: boolean;
}

export class ProviderConfigurationError extends Error {
  override name = 'ProviderConfigurationError';

  constructor(
    readonly code:
      | 'provider_not_found'
      | 'agent_server_provider_not_found'
      | 'provider_secret_unavailable'
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

    return withProviderMutationLock(this.options.store.root, async () => {
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
        models: [...(input.models ?? previous?.models ?? [])],
        ...(!input.clearApiKey && previous?.apiKeyRef
          ? { apiKeyRef: previous.apiKeyRef }
          : {}),
      };

      const key = `pi-provider/${providerId}`;
      let previousSecret: string | undefined;
      if (input.apiKey !== undefined && previous?.apiKeyRef) {
        try {
          previousSecret = await this.options.secretProviders.resolve(
            parseSecretReferenceString(previous.apiKeyRef),
          );
        } catch {
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

      try {
        providers[providerId] = entry;
        this.options.store.writeProviders(providers);
      } catch (error) {
        if (input.apiKey !== undefined) {
          if (previousSecret !== undefined)
            await this.options.secrets.write(key, previousSecret);
          else await this.options.secrets.delete(key);
        }
        throw error;
      }
      if (input.clearApiKey && previous?.apiKeyRef) {
        await this.options.secrets.delete(key);
      }
      return providerView(entry);
    });
  }

  async remove(providerIdInput: string): Promise<void> {
    const providerId = assertProviderId(providerIdInput);
    await withProviderMutationLock(this.options.store.root, async () => {
      const providers = this.options.store.readProviders();
      const provider = providers[providerId];
      if (!provider) {
        throw new ProviderConfigurationError(
          'agent_server_provider_not_found',
          `Provider ${providerId} was not found`,
          404,
        );
      }
      delete providers[providerId];
      this.options.store.writeProviders(providers);
      if (provider.apiKeyRef) {
        await this.options.secrets.delete(`pi-provider/${providerId}`);
      }
    });
  }

  async discover(
    providerIdInput: string,
    options: { save?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ models: string[] }> {
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
    let apiKey: string | undefined;
    if (provider.apiKeyRef) {
      try {
        apiKey = await this.options.secretProviders.resolve(
          parseSecretReferenceString(provider.apiKeyRef),
        );
      } catch (error) {
        this.logger.warn(
          {
            ...safeProviderErrorContext(error),
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
    const headers: Record<string, string> = apiKey
      ? { authorization: `Bearer ${apiKey}` }
      : {};
    const failures: DiscoveryFailure[] = [];
    const collector = new ModelDiscoveryCollector();
    const tryJson = async (
      endpoint: 'openai_models' | 'ollama_tags',
      url: string,
    ): Promise<unknown> => {
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(
          this.options.requestTimeoutMs ?? 10_000,
        );
        response = await this.fetchImpl(url, {
          headers,
          redirect: 'error',
          signal: options.signal
            ? AbortSignal.any([options.signal, timeout])
            : timeout,
        });
      } catch (error) {
        const errorType = error instanceof Error ? error.name : typeof error;
        failures.push({ kind: 'network', errorType });
        this.logger.warn(
          {
            code: 'agent_server_provider_discovery_request_failed',
            endpoint,
            errorType,
            providerId,
          },
          'Provider model discovery request failed',
        );
        return null;
      }
      if (!response.ok) {
        failures.push({ kind: 'http', status: response.status });
        const context = {
          code: 'agent_server_provider_discovery_upstream_error',
          endpoint,
          providerId,
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
        failures.push({ kind: 'invalid_response' });
        this.logger.warn(
          {
            code: 'agent_server_provider_discovery_invalid_json',
            endpoint,
            providerId,
          },
          'Provider model discovery returned invalid JSON',
        );
        return null;
      }
    };

    collector.addOpenAiResponse(
      await tryJson('openai_models', `${baseUrl}/models`),
    );
    if (isOllamaProvider(providerId, parsed)) {
      // Ollama Cloud exposes additional cloud-only tags through /api/tags that
      // are not guaranteed to appear in its OpenAI-compatible model list.
      collector.addOllamaResponse(
        await tryJson('ollama_tags', `${parsed.origin}/api/tags`),
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
    if (options.save) await this.set(providerId, { models: result.models });
    this.logger.info(
      {
        code: 'agent_server_provider_discovery_completed',
        modelCount: result.models.length,
        providerId,
      },
      'Provider model discovery completed',
    );
    return { models: result.models };
  }
}

export function providerView(provider: ProviderEntry): ProviderView {
  return {
    api: provider.api,
    baseUrl: provider.baseUrl,
    envName: provider.envName,
    models: [...provider.models],
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

function safeProviderErrorContext(
  error: unknown,
): Record<string, string | number> {
  const context: Record<string, string | number> = {
    errorType: error instanceof Error ? error.name : typeof error,
  };
  const applicationCode = safeErrorToken(
    (error as { code?: unknown } | null)?.code,
  );
  if (applicationCode) context['applicationCode'] = applicationCode;
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error) {
    context['causeType'] = cause.name;
    const causeMessage = safeLogMessage(cause.message);
    if (causeMessage) context['causeMessage'] = causeMessage;
  }
  const fsCode = safeErrorToken((cause as NodeJS.ErrnoException | null)?.code);
  const syscall = safeErrorToken(
    (cause as NodeJS.ErrnoException | null)?.syscall,
  );
  if (fsCode) context['fsCode'] = fsCode;
  if (syscall) context['syscall'] = syscall;
  const causeStatus = (cause as { statusCode?: unknown } | null)?.statusCode;
  if (typeof causeStatus === 'number') context['causeStatusCode'] = causeStatus;
  return context;
}

function safeLogMessage(value: string): string | undefined {
  const normalized = value.replace(/[\r\n\t]/gu, ' ').trim();
  return normalized ? normalized.slice(0, 500) : undefined;
}

function safeErrorToken(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9_:-]{1,64}$/iu.test(value)
    ? value
    : undefined;
}
