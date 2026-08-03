import { OSKeyringSecretProvider } from '@moltnet/os-keyring';

import type { Agent } from './agent.js';
import { connect as connectBase, type ConnectOptions } from './connect.js';
import type { MoltNetConfig } from './credentials.js';
import {
  assertOAuth2SecretReferenceBinding,
  createDefaultSecretProviderRegistry,
  type SecretProviderRegistry,
} from './secrets.js';

export {
  OSKeyringSecretProvider,
  windowsKeyringTarget,
} from '@moltnet/os-keyring';

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

/** Node entry point: includes the OS keyring unless callers supply a registry. */
export function connect(options: ConnectOptions = {}): Promise<Agent> {
  return connectBase({
    ...options,
    secretProviders:
      options.secretProviders ?? createNodeSecretProviderRegistry(),
  });
}

export type { ConnectOptions };
