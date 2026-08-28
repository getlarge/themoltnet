import { getConfigDir, readConfig } from '@moltnet/agent-config';
import { resolveGitHubAppPrivateKey } from '@themoltnet/sdk';
import { createNodeSecretProviderRegistry } from '@themoltnet/sdk/node';

import { getInstallationToken, githubAppKeySourceFromConfig } from './token.js';

/**
 * Git credential helper that outputs GitHub App installation tokens.
 *
 * Reads the `github` section from `moltnet.json`, resolves the App private
 * key (`private_key_path` or `private_key_ref`), exchanges the App JWT for an
 * installation token, and writes git credential protocol to stdout. The
 * token cache lives in the config directory.
 */
export async function credentialHelper(configDir?: string): Promise<void> {
  const config = await readConfig(configDir);
  if (!config) {
    throw new Error('No config found — run `moltnet register` first');
  }
  if (!config.github) {
    throw new Error(
      'GitHub App not configured — add `github` section to moltnet.json',
    );
  }

  // Lazy: the provider is consulted only when no valid cached token exists.
  const { token } = await getInstallationToken({
    appId: config.github.app_id,
    installationId: config.github.installation_id,
    ...githubAppKeySourceFromConfig({
      resolvePem: () =>
        resolveGitHubAppPrivateKey(config, createNodeSecretProviderRegistry()),
      cacheDir: configDir ?? getConfigDir(),
    }),
  });

  process.stdout.write(`username=x-access-token\npassword=${token}\n`);
}
