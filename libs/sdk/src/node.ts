import type { Agent } from './agent.js';
import { connect as connectBase, type ConnectOptions } from './connect.js';
import type { MoltNetConfig } from './credentials.js';
import {
  assertOAuth2SecretReferenceBinding,
  createDefaultSecretProviderRegistry,
  MOLTNET_SECRET_SERVICE,
  OS_KEYRING_SECRET_PROVIDER,
  type SecretProvider,
  type SecretProviderRegistry,
} from './secrets.js';

type OSKeyringModule = {
  OSKeyringSecretProvider: new (platform?: NodeJS.Platform) => SecretProvider;
};

/**
 * Lazy Node adapter. Browser SDK installs never pull in native keyring
 * packages, and Node consumers only load the adapter when an os-keyring
 * reference is actually resolved.
 */
export class OSKeyringSecretProvider implements SecretProvider {
  readonly name = OS_KEYRING_SECRET_PROVIDER;
  private providerPromise: Promise<SecretProvider> | undefined;

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  async read(key: string): Promise<string | null> {
    return (await this.provider()).read(key);
  }

  async write(key: string, value: string): Promise<void> {
    return (await this.provider()).write(key, value);
  }

  async delete(key: string): Promise<void> {
    return (await this.provider()).delete(key);
  }

  private provider(): Promise<SecretProvider> {
    // The package remains isomorphic; this explicit /node entry is the only
    // surface allowed to load the optional Node-only adapter.
    // eslint-disable-next-line @nx/enforce-module-boundaries
    this.providerPromise ??= import('@themoltnet/os-keyring')
      .then(
        ({ OSKeyringSecretProvider: Provider }: OSKeyringModule) =>
          new Provider(this.platform),
      )
      .catch((error: unknown) => {
        throw new Error(
          'OS keyring support requires @themoltnet/os-keyring; install it in this Node application',
          { cause: error },
        );
      });
    return this.providerPromise;
  }
}

export function windowsKeyringTarget(
  service: string,
  key: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  return platform === 'win32' ? `${service}/${key}` : undefined;
}

export function createNodeSecretProviderRegistry(
  platform: NodeJS.Platform = process.platform,
): SecretProviderRegistry {
  return createDefaultSecretProviderRegistry().register(
    new OSKeyringSecretProvider(platform),
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
    assertOAuth2SecretReferenceBinding(
      secretReference,
      config.identity_id,
      config.oauth2.client_id,
    );
    return secretProviders.resolve(secretReference);
  }
  if (legacySecret) {
    return legacySecret;
  }
  throw new Error(
    'OAuth2 config must set exactly one of client_secret or client_secret_ref',
  );
}

/** Node entry point: includes the lazy OS keyring unless callers supply a registry. */
export function connect(options: ConnectOptions = {}): Promise<Agent> {
  return connectBase({
    ...options,
    secretProviders:
      options.secretProviders ?? createNodeSecretProviderRegistry(),
  });
}

export { MOLTNET_SECRET_SERVICE };
export type { ConnectOptions };
