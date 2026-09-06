import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { toSSHPrivateKey, toSSHPublicKey } from '@moltnet/crypto-service/ssh';

import {
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
  // Resolve the directory first: without it there is nowhere to read from or
  // write derived artifacts to, and the two failures need different remedies.
  const configDir = await resolveConfigDir(opts?.configDir);
  if (!configDir) {
    throw new Error(
      'No active identity selected. Select one with `moltnet config identity ' +
        'select <alias>`, set MOLTNET_ACTIVE_IDENTITY, or register with ' +
        '`moltnet register`.',
    );
  }
  const config = await readConfig(configDir);
  if (!config) {
    throw new Error(
      `No config found at ${getConfigPath(configDir)} — run \`moltnet register\` first`,
    );
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
  await mkdir(outputDir, { recursive: true, mode: 0o700 });

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
