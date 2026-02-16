import { appendFile, readFile } from 'node:fs/promises';

import { exportSSHKey, readConfig, updateConfigSection } from '@themoltnet/sdk';

import { buildBotEmail, lookupBotUser } from './bot-user.js';
import { setupGitIdentity } from './git-setup.js';

export interface SetupGitHubAgentOptions {
  /** Path to `moltnet.json` directory */
  configDir?: string;
  /** GitHub App slug (falls back to `github.app_slug` in config) */
  appSlug?: string;
  /** Git committer display name (falls back to app slug) */
  name?: string;
}

export interface SetupGitHubAgentResult {
  name: string;
  email: string;
  appSlug: string;
  botUserId: number;
  gitconfigPath: string;
}

/**
 * One-command setup for GitHub App git identity.
 *
 * Mirrors the Go CLI `moltnet github setup`:
 * 1. Export SSH keys if not already present
 * 2. Look up the bot user ID from GitHub API
 * 3. Configure git identity with correct bot email
 * 4. Persist `app_slug` to config
 * 5. Add credential helper to gitconfig
 */
export async function setupGitHubAgent(
  opts: SetupGitHubAgentOptions,
): Promise<SetupGitHubAgentResult> {
  const config = await readConfig(opts.configDir);
  if (!config) {
    throw new Error('No config found — run `moltnet register` first');
  }
  if (!config.github) {
    throw new Error(
      "GitHub App not configured — add 'github' section to moltnet.json",
    );
  }

  // Resolve app slug
  const appSlug = opts.appSlug ?? config.github.app_slug;
  if (!appSlug) {
    throw new Error(
      'App slug required — pass appSlug option or set github.app_slug in moltnet.json',
    );
  }

  // Step 1: Export SSH keys if not present
  if (!config.ssh) {
    await exportSSHKey({ configDir: opts.configDir });
  }

  // Step 2: Look up bot user ID
  const { id: botUserId } = await lookupBotUser(appSlug);
  const email = buildBotEmail(botUserId, appSlug);

  // Step 3: Determine name
  const name = opts.name ?? appSlug;

  // Step 4: Configure git identity
  const gitconfigPath = await setupGitIdentity({
    name,
    email,
    configDir: opts.configDir,
  });

  // Step 5: Persist app_slug if not already stored
  if (!config.github.app_slug) {
    await updateConfigSection(
      'github',
      { ...config.github, app_slug: appSlug },
      opts.configDir,
    );
  }

  // Step 6: Add credential helper to gitconfig
  const existingGitconfig = await readFile(gitconfigPath, 'utf-8');
  if (!existingGitconfig.includes('credential')) {
    const helperCmd = opts.configDir
      ? `moltnet github credential-helper --credentials ${opts.configDir}/moltnet.json`
      : 'moltnet github credential-helper';
    const credSection = `\n[credential "https://github.com"]\n\thelper = ${helperCmd}\n`;
    await appendFile(gitconfigPath, credSection);
  }

  return { name, email, appSlug, botUserId, gitconfigPath };
}
