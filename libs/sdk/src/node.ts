import { AsyncEntry } from '@napi-rs/keyring';

import type { Agent } from './agent.js';
import { connect as connectBase, type ConnectOptions } from './connect.js';
import type { MoltNetConfig } from './credentials.js';
import {
  createDefaultSecretProviderRegistry,
  MOLTNET_SECRET_SERVICE,
  OS_KEYRING_SECRET_PROVIDER,
  type SecretProvider,
  type SecretProviderRegistry,
} from './secrets.js';

export class OSKeyringSecretProvider implements SecretProvider {
  readonly name = OS_KEYRING_SECRET_PROVIDER;

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  async read(key: string): Promise<string | null> {
    try {
      return (await this.entry(key).getPassword()) || null;
    } catch (error) {
      if (isMissingKeyringEntry(error)) {
        return null;
      }
      throw error;
    }
  }

  async write(key: string, value: string): Promise<void> {
    await this.entry(key).setPassword(value);
  }

  async delete(key: string): Promise<void> {
    try {
      const entry = this.entry(key);
      const deleted = await entry.deleteCredential();
      if (!deleted && (await entry.getPassword())) {
        throw new Error('OS keyring reported that the secret was not deleted');
      }
    } catch (error) {
      if (!isMissingKeyringEntry(error)) {
        throw error;
      }
    }
  }

  private entry(key: string): AsyncEntry {
    const target = windowsKeyringTarget(
      MOLTNET_SECRET_SERVICE,
      key,
      this.platform,
    );
    return target
      ? AsyncEntry.withTarget(target, MOLTNET_SECRET_SERVICE, key)
      : new AsyncEntry(MOLTNET_SECRET_SERVICE, key);
  }
}

/** Match github.com/zalando/go-keyring's Windows credential target. */
export function windowsKeyringTarget(
  service: string,
  key: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  return platform === 'win32' ? `${service}:${key}` : undefined;
}

function isMissingKeyringEntry(error: unknown): boolean {
  return (
    error instanceof Error &&
    /no entry|not found|no matching/i.test(error.message)
  );
}

export function createNodeSecretProviderRegistry(): SecretProviderRegistry {
  return createDefaultSecretProviderRegistry().register(
    new OSKeyringSecretProvider(),
  );
}

/** Resolve either a legacy plaintext secret or an opaque reference in Node. */
export async function resolveNodeOAuth2ClientSecret(
  config: MoltNetConfig,
  secretProviders = createNodeSecretProviderRegistry(),
): Promise<string> {
  const legacySecret = config.oauth2.client_secret;
  const secretReference = config.oauth2.client_secret_ref;
  if (legacySecret && secretReference) {
    throw new Error(
      'OAuth2 config must set exactly one of client_secret or client_secret_ref',
    );
  }
  if (secretReference) {
    return secretProviders.resolve(secretReference);
  }
  if (legacySecret) {
    return legacySecret;
  }
  throw new Error(
    'OAuth2 config must set exactly one of client_secret or client_secret_ref',
  );
}

/** Node entry point: includes the OS keyring unless callers supply a registry. */
export function connect(options: ConnectOptions = {}): Promise<Agent> {
  return connectBase({
    ...options,
    secretProviders:
      options.secretProviders ?? createNodeSecretProviderRegistry(),
  });
}

export type { ConnectOptions };
