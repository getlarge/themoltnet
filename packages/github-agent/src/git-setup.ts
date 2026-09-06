import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  readConfig,
  resolveConfigDir,
  updateConfigSection,
} from '@moltnet/agent-config';

/**
 * Set up git identity for a MoltNet agent.
 *
 * Generates a gitconfig and allowed_signers file for SSH commit signing.
 * Requires SSH keys to have been exported first (via `exportSSHKey()`).
 */
export async function setupGitIdentity(opts?: {
  name?: string;
  email?: string;
  configDir?: string;
}): Promise<string> {
  const configDir = await resolveConfigDir(opts?.configDir);
  const config = await readConfig(configDir ?? undefined);
  if (!config) {
    throw new Error('No config found — run `moltnet register` first');
  }
  if (!configDir) throw new Error('No active identity selected');
  if (!config.ssh) {
    throw new Error(
      'SSH keys not exported — run `moltnet ssh-key export` first',
    );
  }

  // Read the public key content for allowed_signers
  const publicKey = await readFile(config.ssh.public_key_path, 'utf-8');

  // Determine name/email
  const name = opts?.name ?? `moltnet-agent-${config.identity_id.slice(0, 8)}`;
  const email = opts?.email ?? `${config.identity_id}@agents.themolt.net`;

  // Build allowed_signers (email <public-key>)
  const sshDir = join(configDir, 'ssh');
  const allowedSignersPath = join(sshDir, 'allowed_signers');
  await mkdir(sshDir, { recursive: true });
  await writeFile(allowedSignersPath, `${email} ${publicKey.trim()}\n`);

  // Build gitconfig INI
  const gitconfig = [
    '[user]',
    `\tname = ${name}`,
    `\temail = ${email}`,
    `\tsigningkey = ${config.ssh.public_key_path}`,
    '',
    '[gpg]',
    '\tformat = ssh',
    '',
    '[gpg "ssh"]',
    `\tallowedSignersFile = ${allowedSignersPath}`,
    '',
    '[commit]',
    '\tgpgsign = true',
    '',
    '[tag]',
    '\tgpgsign = true',
    '',
  ].join('\n');

  const gitconfigPath = join(configDir, 'gitconfig');
  await writeFile(gitconfigPath, gitconfig);

  // Update moltnet.json git section
  await updateConfigSection(
    'git',
    {
      name,
      email,
      signing: true,
      config_path: gitconfigPath,
    },
    configDir,
  );

  return gitconfigPath;
}
