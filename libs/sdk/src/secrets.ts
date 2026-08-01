import { readEnvironmentVariable } from './config.js';
import type { SecretReference } from './credentials.js';

export const ENVIRONMENT_SECRET_PROVIDER = 'env';
export const OS_KEYRING_SECRET_PROVIDER = 'os-keyring';
export const MOLTNET_SECRET_SERVICE = 'themolt.net';

export interface SecretProvider {
  readonly name: string;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class SecretProviderRegistry {
  readonly #providers = new Map<string, SecretProvider>();

  register(provider: SecretProvider): this {
    const name = provider.name.trim();
    if (!name) {
      throw new Error('Secret provider name must not be empty');
    }
    this.#providers.set(name, provider);
    return this;
  }

  get(name: string): SecretProvider | undefined {
    return this.#providers.get(name);
  }

  async resolve(reference: SecretReference): Promise<string> {
    const providerName = reference.provider.trim();
    const key = reference.key.trim();
    if (!providerName || !key) {
      throw new Error('Secret reference requires provider and key');
    }
    const provider = this.get(providerName);
    if (!provider) {
      throw new Error(
        `Secret provider ${JSON.stringify(providerName)} is not registered`,
      );
    }
    const value = await provider.read(key);
    if (!value) {
      throw new Error(
        `Secret provider ${JSON.stringify(providerName)} has no value for the requested key`,
      );
    }
    return value;
  }
}

export class EnvironmentSecretProvider implements SecretProvider {
  readonly name = ENVIRONMENT_SECRET_PROVIDER;

  constructor(
    private readonly readValue: (
      key: string,
    ) => string | undefined = readEnvironmentVariable,
  ) {}

  read(key: string): Promise<string | null> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return Promise.reject(
        new Error('Environment secret key must be a variable name'),
      );
    }
    return Promise.resolve(this.readValue(key) || null);
  }

  write(_key: string, _value: string): Promise<void> {
    return Promise.reject(
      new Error('Environment secret provider is read-only'),
    );
  }

  delete(_key: string): Promise<void> {
    return Promise.reject(
      new Error('Environment secret provider is read-only'),
    );
  }
}

export function createDefaultSecretProviderRegistry(): SecretProviderRegistry {
  return new SecretProviderRegistry().register(new EnvironmentSecretProvider());
}

export function oauth2SecretKey(identityId: string, clientId: string): string {
  return `oauth2/${identityId}/${clientId}`;
}
