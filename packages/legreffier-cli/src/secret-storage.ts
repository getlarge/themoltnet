import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  type MoltNetConfig,
  OS_KEYRING_SECRET_PROVIDER,
  readConfig,
  writeConfig,
} from '@themoltnet/sdk';
import { createNodeSecretProviderRegistry } from '@themoltnet/sdk/node';

const execFileAsync = promisify(execFile);

export type ConfigMigrationRunner = (credentialsPath: string) => Promise<void>;

async function runConfigMigration(credentialsPath: string): Promise<void> {
  await execFileAsync(
    'moltnet',
    ['config', 'migrate', '--credentials', credentialsPath],
    { timeout: 30_000 },
  );
}

/**
 * Persist a newly issued or legacy plaintext OAuth2 secret in the OS keyring
 * before replacing config with a stable reference. Existing references pass
 * through unchanged.
 */
export async function ensureKeyringSecretReference(
  configDir: string,
  config: MoltNetConfig,
  issuedSecret = '',
  migrate: ConfigMigrationRunner = runConfigMigration,
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

  const credentialsPath = join(configDir, 'moltnet.json');
  await writeConfig(
    {
      ...config,
      oauth2: {
        client_id: config.oauth2.client_id,
        client_secret: plaintext,
      },
    },
    configDir,
  );

  try {
    await migrate(credentialsPath);
  } catch (cause) {
    throw new Error(
      'Could not migrate the OAuth2 secret with `moltnet config migrate`.',
      { cause },
    );
  }

  const migrated = await readConfig(configDir);
  if (
    !migrated ||
    !('client_secret_ref' in migrated.oauth2) ||
    migrated.oauth2.client_secret_ref?.provider !== OS_KEYRING_SECRET_PROVIDER
  ) {
    throw new Error(
      'The MoltNet CLI did not produce an OS-keyring OAuth2 secret reference.',
    );
  }
  return migrated;
}
