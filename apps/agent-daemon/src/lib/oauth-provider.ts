import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { ModelRuntime } from '@earendil-works/pi-coding-agent';

import { withProviderOAuthLock } from './provider-lock.js';

const EXCLUDED_OAUTH_PROVIDERS = new Set(['github-copilot']);

export interface OAuthProviderView {
  id: string;
  name: string;
  connected: boolean;
}

export interface OAuthProviderLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

const silentLogger: OAuthProviderLogger = {
  warn: () => undefined,
};

export class OAuthProviderError extends Error {
  override name = 'OAuthProviderError';
  constructor(
    readonly code: 'provider_unknown',
    message: string,
  ) {
    super(message);
  }
}

export class OAuthProviderService {
  private constructor(
    readonly authPath: string,
    private readonly runtime: ModelRuntime,
    private readonly logger: OAuthProviderLogger,
  ) {}

  static async create(options: {
    authPath: string;
    modelRuntime?: ModelRuntime;
    logger?: OAuthProviderLogger;
  }): Promise<OAuthProviderService> {
    const runtime =
      options.modelRuntime ??
      (await ModelRuntime.create({
        authPath: options.authPath,
        refreshOnCreate: false,
      }));
    return new OAuthProviderService(
      options.authPath,
      runtime,
      options.logger ?? silentLogger,
    );
  }

  list(): OAuthProviderView[] {
    const providers = this.oauthProviders();
    const connected = this.connectedProviderIds(providers);
    return providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      connected: connected.has(provider.id),
    }));
  }

  async login(
    providerId: string,
    interaction: Parameters<ModelRuntime['login']>[2],
  ): Promise<void> {
    this.assertProvider(providerId);
    await withProviderOAuthLock(
      dirname(this.authPath),
      providerId,
      async () => {
        await this.runtime.login(providerId, 'oauth', interaction);
      },
    );
  }

  async logout(providerId: string): Promise<void> {
    this.assertProvider(providerId);
    await withProviderOAuthLock(dirname(this.authPath), providerId, () =>
      this.runtime.logout(providerId),
    );
  }

  private assertProvider(providerId: string): void {
    if (!this.oauthProviders().some((provider) => provider.id === providerId)) {
      throw new OAuthProviderError(
        'provider_unknown',
        `"${providerId}" is not a known OAuth provider`,
      );
    }
  }

  private oauthProviders(): { id: string; name: string }[] {
    return this.runtime
      .getProviders()
      .filter(
        (provider) =>
          provider.auth.oauth !== undefined &&
          !EXCLUDED_OAUTH_PROVIDERS.has(provider.id),
      )
      .map(({ id, name }) => ({ id, name }));
  }

  private connectedProviderIds(
    providers: { id: string }[],
  ): ReadonlySet<string> {
    try {
      const content = readFileSync(this.authPath, 'utf8').replace(
        /^\uFEFF/u,
        '',
      );
      const parsed = JSON.parse(content) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error('Invalid auth.json: expected an object');
      }
      return new Set(Object.keys(parsed));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        for (const provider of providers) {
          this.logger.warn(
            {
              event: 'agent-server.subscription_auth_read_failed',
              providerId: provider.id,
              ...safeOAuthError(error),
            },
            'Could not read subscription authentication state',
          );
        }
      }
      return new Set();
    }
  }
}

function safeOAuthError(error: unknown): Record<string, string> {
  const result: Record<string, string> = {
    errorType: error instanceof Error ? error.name : typeof error,
  };
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[a-z0-9_:-]{1,64}$/iu.test(code)) {
    result['applicationCode'] = code;
  }
  return result;
}
