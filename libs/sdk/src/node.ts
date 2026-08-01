import { AsyncEntry } from '@napi-rs/keyring';

import {
  createDefaultSecretProviderRegistry,
  MOLTNET_SECRET_SERVICE,
  OS_KEYRING_SECRET_PROVIDER,
  type SecretProvider,
  type SecretProviderRegistry,
} from './secrets.js';

export class OSKeyringSecretProvider implements SecretProvider {
  readonly name = OS_KEYRING_SECRET_PROVIDER;

  async read(key: string): Promise<string | null> {
    try {
      return (
        (await new AsyncEntry(MOLTNET_SECRET_SERVICE, key).getPassword()) ||
        null
      );
    } catch (error) {
      if (isMissingKeyringEntry(error)) {
        return null;
      }
      throw error;
    }
  }

  async write(key: string, value: string): Promise<void> {
    await new AsyncEntry(MOLTNET_SECRET_SERVICE, key).setPassword(value);
  }

  async delete(key: string): Promise<void> {
    try {
      await new AsyncEntry(MOLTNET_SECRET_SERVICE, key).deletePassword();
    } catch (error) {
      if (!isMissingKeyringEntry(error)) {
        throw error;
      }
    }
  }
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
