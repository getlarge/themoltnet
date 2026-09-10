import { dirname } from 'node:path';

import {
  ModelRuntime,
  readStoredCredential,
} from '@earendil-works/pi-coding-agent';

import { withProviderOAuthLock } from './provider-lock.js';

const EXCLUDED_OAUTH_PROVIDERS = new Set(['github-copilot']);

export interface OAuthProviderView {
  id: string;
  name: string;
  connected: boolean;
}

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
  ) {}

  static async create(options: {
    authPath: string;
    modelRuntime?: ModelRuntime;
  }): Promise<OAuthProviderService> {
    const runtime =
      options.modelRuntime ??
      (await ModelRuntime.create({
        authPath: options.authPath,
        refreshOnCreate: false,
      }));
    return new OAuthProviderService(options.authPath, runtime);
  }

  list(): OAuthProviderView[] {
    return this.runtime
      .getProviders()
      .filter(
        (provider) =>
          provider.auth.oauth !== undefined &&
          !EXCLUDED_OAUTH_PROVIDERS.has(provider.id),
      )
      .map((provider) => {
        let connected = false;
        try {
          connected =
            readStoredCredential(provider.id, this.authPath) !== undefined;
        } catch {
          // A malformed or temporarily unreadable auth store must not make
          // provider discovery unavailable. This matches Agent Server's
          // previous behavior: report the provider as disconnected.
        }
        return { id: provider.id, name: provider.name, connected };
      });
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
    if (!this.list().some((provider) => provider.id === providerId)) {
      throw new OAuthProviderError(
        'provider_unknown',
        `"${providerId}" is not a known OAuth provider`,
      );
    }
  }
}
