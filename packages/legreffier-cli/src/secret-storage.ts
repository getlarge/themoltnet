import {
  type MoltNetConfig,
  oauth2SecretKey,
  OS_KEYRING_SECRET_PROVIDER,
  type SecretProviderRegistry,
  type SecretReference,
  writeConfig,
} from '@themoltnet/sdk';
import { createNodeSecretProviderRegistry } from '@themoltnet/sdk/node';

/**
 * Persist a newly issued or legacy plaintext OAuth2 secret in the OS keyring
 * and replace it in config with a stable reference. Existing references are
 * verified and passed through unchanged. The plaintext never touches disk.
 */
export async function ensureKeyringSecretReference(
  configDir: string,
  config: MoltNetConfig,
  issuedSecret = '',
  registry: SecretProviderRegistry = createNodeSecretProviderRegistry(),
): Promise<MoltNetConfig> {
  const existingReference =
    'client_secret_ref' in config.oauth2
      ? config.oauth2.client_secret_ref
      : undefined;
  if (existingReference) {
    if (
      existingReference.provider === OS_KEYRING_SECRET_PROVIDER &&
      (await registry.probe(existingReference)) !== 'present'
    ) {
      throw new Error(
        'The OAuth2 secret referenced by config is missing from the OS keyring.',
      );
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

  const reference: SecretReference = {
    provider: OS_KEYRING_SECRET_PROVIDER,
    key: oauth2SecretKey(config.identity_id, config.oauth2.client_id),
  };
  const { changed } = await registry.ensure(reference, plaintext);

  const secured: MoltNetConfig = {
    ...config,
    oauth2: {
      client_id: config.oauth2.client_id,
      client_secret_ref: reference,
    },
  };
  try {
    await writeConfig(secured, configDir);
  } catch (cause) {
    if (changed) {
      await registry.delete(reference).catch(() => undefined);
    }
    throw new Error('Could not write the OAuth2 secret reference to config.', {
      cause,
    });
  }
  return secured;
}
