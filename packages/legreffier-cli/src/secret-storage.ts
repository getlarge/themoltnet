import {
  type MoltNetConfig,
  oauth2SecretKey,
  OS_KEYRING_SECRET_PROVIDER,
  writeConfig,
} from '@themoltnet/sdk';
import { createNodeSecretProviderRegistry } from '@themoltnet/sdk/node';

/**
 * Persist a newly issued or legacy plaintext OAuth2 secret in the OS keyring
 * before replacing config with a stable reference. Existing references pass
 * through unchanged.
 */
export async function ensureKeyringSecretReference(
  configDir: string,
  config: MoltNetConfig,
  issuedSecret = '',
): Promise<MoltNetConfig> {
  if ('client_secret_ref' in config.oauth2 && config.oauth2.client_secret_ref) {
    if (
      config.oauth2.client_secret_ref.provider === OS_KEYRING_SECRET_PROVIDER
    ) {
      const provider = createNodeSecretProviderRegistry().get(
        OS_KEYRING_SECRET_PROVIDER,
      );
      if (
        !provider ||
        !(await provider.read(config.oauth2.client_secret_ref.key))
      ) {
        throw new Error(
          'The OAuth2 secret referenced by config is missing from the OS keyring.',
        );
      }
    }
    return config;
  }

  const plaintext =
    issuedSecret ||
    ('client_secret' in config.oauth2 ? config.oauth2.client_secret : '');
  if (!plaintext || !config.identity_id || !config.oauth2.client_id) {
    throw new Error(
      'Cannot secure OAuth2 credentials: identity, client ID, or issued secret is missing.',
    );
  }

  const registry = createNodeSecretProviderRegistry();
  const provider = registry.get(OS_KEYRING_SECRET_PROVIDER);
  if (!provider) {
    throw new Error('OS keyring secret provider is unavailable.');
  }
  const key = oauth2SecretKey(config.identity_id, config.oauth2.client_id);
  const previous = await provider.read(key);
  await provider.write(key, plaintext);

  const updated: MoltNetConfig = {
    ...config,
    oauth2: {
      client_id: config.oauth2.client_id,
      client_secret_ref: {
        provider: OS_KEYRING_SECRET_PROVIDER,
        key,
      },
    },
  };
  try {
    await writeConfig(updated, configDir);
  } catch (error) {
    if (previous) await provider.write(key, previous);
    else await provider.delete(key);
    throw error;
  }
  return updated;
}
