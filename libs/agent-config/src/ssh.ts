import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { toSSHPrivateKey, toSSHPublicKey } from '@moltnet/crypto-service/ssh';

import {
  getConfigDir,
  getConfigPath,
  readConfig,
  resolveConfigDir,
  updateConfigSection,
} from './config.js';

/**
 * Write the agent's Ed25519 key as an OpenSSH keypair. `privateKey` is the
 * base64 seed; when omitted the legacy plaintext `keys.private_key` is used.
 * A `keys.private_key_ref` must be resolved by the caller (the SDK's
 * `exportSSHKey` does this) because this package has no secret-provider
 * dependency.
 */
export async function exportSSHKey(opts?: {
  configDir?: string;
  outputDir?: string;
  privateKey?: string;
}): Promise<{ privatePath: string; publicPath: string }> {
  const configDir = await resolveConfigDir(opts?.configDir);
  const config = await readConfig(configDir ?? undefined);
  if (!config) {
    throw new Error(
      `No config found at ${getConfigPath(opts?.configDir)} — run \`moltnet register\` first`,
    );
  }
  if (!configDir) {
    throw new Error('No active identity selected');
  }
  const seed =
    opts?.privateKey ??
    ('private_key' in config.keys ? config.keys.private_key : undefined);
  if (!seed) {
    throw new Error(
      'exportSSHKey requires keys.private_key or a resolved privateKey; resolve keys.private_key_ref through the SDK first',
    );
  }

  const privateKeySSH = toSSHPrivateKey(seed);
  const publicKeySSH = toSSHPublicKey(config.keys.public_key);
  const outputDir = opts?.outputDir ?? join(configDir, 'ssh');
  await mkdir(outputDir, { recursive: true });

  const privatePath = join(outputDir, 'id_ed25519');
  const publicPath = join(outputDir, 'id_ed25519.pub');
  await writeFile(privatePath, privateKeySSH, { mode: 0o600 });
  await writeFile(publicPath, publicKeySSH, { mode: 0o644 });
  await updateConfigSection(
    'ssh',
    { private_key_path: privatePath, public_key_path: publicPath },
    configDir,
  );
  return { privatePath, publicPath };
}
