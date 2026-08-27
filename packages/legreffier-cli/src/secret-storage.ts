import {
  type MoltNetConfig,
  oauth2SecretKey,
  OS_KEYRING_SECRET_PROVIDER,
  readConfig,
  SecretEnsureError,
  type SecretProviderRegistry,
  type SecretReference,
  writeConfig,
} from '@themoltnet/sdk';
import { createNodeSecretProviderRegistry } from '@themoltnet/sdk/node';

/**
 * Persist a newly issued or legacy plaintext OAuth2 secret in the OS keyring
 * and replace it in config with a stable reference. An existing `os-keyring`
 * reference is probed for presence and passed through; references to other
 * providers pass through unverified. The plaintext never touches disk.
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
    if (existingReference.provider === OS_KEYRING_SECRET_PROVIDER) {
      const presence = await registry.probe(existingReference);
      if (presence === 'absent') {
        throw new Error(
          'The OAuth2 secret referenced by config is missing from the OS keyring.',
        );
      }
      if (presence === 'inaccessible') {
        throw new Error(
          'The OS keyring holding the OAuth2 secret could not be accessed; unlock it or check that native keyring bindings are installed.',
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

  const reference: SecretReference = {
    provider: OS_KEYRING_SECRET_PROVIDER,
    key: oauth2SecretKey(config.identity_id, config.oauth2.client_id),
  };
  let changed: boolean;
  try {
    ({ changed } = await registry.ensure(reference, plaintext));
  } catch (error) {
    if (error instanceof SecretEnsureError && error.changed) {
      await rollbackKeyring(registry, reference, error);
    }
    throw error;
  }

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
    const failure = new Error(
      'Could not write the OAuth2 secret reference to config.',
      { cause },
    );
    // writeConfig commits by rename, so a rejection means the reference was
    // not persisted — unless a previous config already carried it.
    const persisted = await readConfig(configDir).catch(() => null);
    const referenced =
      persisted !== null &&
      'client_secret_ref' in persisted.oauth2 &&
      persisted.oauth2.client_secret_ref?.provider === reference.provider &&
      persisted.oauth2.client_secret_ref.key === reference.key;
    if (changed && !referenced) {
      await rollbackKeyring(registry, reference, failure);
    }
    throw failure;
  }
  return secured;
}

async function rollbackKeyring(
  registry: SecretProviderRegistry,
  reference: SecretReference,
  failure: Error,
): Promise<void> {
  try {
    await registry.delete(reference);
  } catch (cause) {
    throw new Error(
      `${failure.message} Rolling back the ${reference.provider} entry ${reference.key} also failed; remove it manually.`,
      { cause: new AggregateError([failure, cause]) },
    );
  }
}
