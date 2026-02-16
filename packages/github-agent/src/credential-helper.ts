import { readConfig } from '@themoltnet/sdk';

import { getInstallationToken } from './token.js';

/**
 * Git credential helper that outputs GitHub App installation tokens.
 *
 * Reads the `github` section from `moltnet.json`, exchanges the App JWT
 * for an installation token, and writes git credential protocol to stdout.
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

  const { token } = await getInstallationToken({
    appId: config.github.app_id,
    privateKeyPath: config.github.private_key_path,
    installationId: config.github.installation_id,
  });

  process.stdout.write(`username=x-access-token\npassword=${token}\n`);
}
