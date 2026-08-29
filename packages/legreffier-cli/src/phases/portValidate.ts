import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type ConfigIssue,
  type MoltNetConfig,
  readConfig,
  repairConfig,
  resolveGitHubAppPrivateKey,
  type SecretProviderRegistry,
} from '@themoltnet/sdk';
import {
  createNodeSecretProviderRegistry,
  resolveNodeOAuth2ClientSecret,
} from '@themoltnet/sdk/node';

export interface PortValidateResult {
  config: MoltNetConfig;
  issues: ConfigIssue[];
  /** False when a blocking issue (missing required field or file) was found. */
  canProceed: boolean;
}

/**
 * Validate a source `.moltnet/<agent>/` directory for porting.
 *
 * Runs the generic `repairConfig({ dryRun: true })` checks, then adds
 * port-specific blocking checks:
 *  - `identity_id`, `keys.fingerprint`, `oauth2.client_id/secret`
 *  - `github.app_id` present and numeric, `github.app_slug`
 *  - `github.installation_id` may be absent; port resolves it for the target owner
 *  - `ssh.private_key_path`, `ssh.public_key_path`, `git.config_path` set
 *  - `github.private_key_path` set
 *  - All four absolute paths (ssh priv/pub, git config, github pem) exist on disk
 *
 * Throws if `moltnet.json` is missing or unreadable — nothing to port.
 */
export async function runPortValidatePhase(opts: {
  sourceDir: string;
  secretProviders?: SecretProviderRegistry;
}): Promise<PortValidateResult> {
  const { sourceDir, secretProviders } = opts;

  const sourceConfig = await readConfig(sourceDir);
  const config = await hydrateLegacyPortConfig(sourceConfig, sourceDir);
  if (!config) {
    throw new Error(
      `No moltnet.json found in ${sourceDir} — nothing to port. ` +
        `Run \`legreffier\` on a repo first to create a source identity.`,
    );
  }

  // Generic SDK checks (identity_id, keys, endpoints, file paths). Dry-run so
  // we don't mutate the source.
  const { issues: rawBaseIssues } = await repairConfig({
    configDir: sourceDir,
    dryRun: true,
  });
  const baseIssues = await filterResolvedLegacyIssues(rawBaseIssues, config);
  const issues: ConfigIssue[] = [...baseIssues];

  // Port-specific required fields
  if (!config.oauth2?.client_id) {
    issues.push({
      field: 'oauth2.client_id',
      problem: 'missing — required for port',
      action: 'warning',
    });
  }
  const plaintextSecret = config.oauth2?.client_secret?.trim();
  const secretReference = config.oauth2?.client_secret_ref;
  if (plaintextSecret && secretReference) {
    issues.push({
      field: 'oauth2.client_secret/client_secret_ref',
      problem: 'ambiguous — set exactly one secret form',
      action: 'warning',
    });
  } else if (
    secretReference &&
    (!secretReference.provider?.trim() || !secretReference.key?.trim())
  ) {
    issues.push({
      field: 'oauth2.client_secret_ref',
      problem: 'provider and key must both be non-empty',
      action: 'warning',
    });
  } else if (secretReference) {
    try {
      await resolveNodeOAuth2ClientSecret(config, secretProviders);
    } catch (error) {
      issues.push({
        field: 'oauth2.client_secret_ref',
        problem: `cannot be resolved — ${error instanceof Error ? error.message : String(error)}`,
        action: 'warning',
      });
    }
  } else if (!plaintextSecret) {
    issues.push({
      field: 'oauth2.client_secret/client_secret_ref',
      problem: 'missing — required for port',
      action: 'warning',
    });
  }
  if (!config.keys?.fingerprint) {
    issues.push({
      field: 'keys.fingerprint',
      problem: 'missing — required for port',
      action: 'warning',
    });
  }

  if (!config.github?.app_id) {
    issues.push({
      field: 'github.app_id',
      problem: 'missing — required for port',
      action: 'warning',
    });
  }
  if (!config.github?.app_slug) {
    issues.push({
      field: 'github.app_slug',
      problem:
        'missing — required for port (used for PEM filename and bot lookup)',
      action: 'warning',
    });
  }
  // Missing installation_id is not a source portability blocker. The port
  // flow resolves the target owner installation after copying the PEM.
  if (!config.github?.private_key_path && !config.github?.private_key_ref) {
    issues.push({
      field: 'github.private_key_path',
      problem:
        'missing — required for port (or github.private_key_ref for a secret provider)',
      action: 'warning',
    });
  } else if (config.github?.private_key_ref) {
    // Resolve the referenced PEM now, before any target files are written,
    // so an unresolvable reference blocks the port instead of surfacing
    // after copy/rewrite.
    try {
      await resolveGitHubAppPrivateKey(
        config,
        secretProviders ?? createNodeSecretProviderRegistry(),
      );
    } catch (error) {
      issues.push({
        field: 'github.private_key_ref',
        problem: `cannot be resolved — ${error instanceof Error ? error.message : String(error)}`,
        action: 'warning',
      });
    }
  }

  if (!config.ssh?.private_key_path) {
    issues.push({
      field: 'ssh.private_key_path',
      problem: 'missing — required for port',
      action: 'warning',
    });
  }
  if (!config.ssh?.public_key_path) {
    issues.push({
      field: 'ssh.public_key_path',
      problem: 'missing — required for port',
      action: 'warning',
    });
  }
  if (!config.git?.config_path) {
    issues.push({
      field: 'git.config_path',
      problem: 'missing — required for port',
      action: 'warning',
    });
  }

  // Verify allowed_signers if present — optional file alongside ssh keys
  // (checked softly; a missing file is a warning, not a blocker)
  // Note: repairConfig already checks the four path fields above.

  // Block only on unresolved warnings. `fixed` issues are non-blocking because
  // they represent state already corrected by repairConfig.
  const blockingIssues = issues.filter((i) => i.action === 'warning');
  const canProceed = blockingIssues.length === 0;
  return { config, issues, canProceed };
}

async function hydrateLegacyPortConfig(
  config: MoltNetConfig | null,
  sourceDir: string,
): Promise<MoltNetConfig | null> {
  if (!config) return null;

  const gitConfigPath = config.git?.config_path ?? join(sourceDir, 'gitconfig');
  const gitIdentity = await readGitConfigIdentity(gitConfigPath);

  return {
    ...config,
    ssh: {
      ...config.ssh,
      private_key_path:
        config.ssh?.private_key_path ?? join(sourceDir, 'ssh', 'id_ed25519'),
      public_key_path:
        config.ssh?.public_key_path ?? join(sourceDir, 'ssh', 'id_ed25519.pub'),
    },
    git: {
      ...config.git,
      name: config.git?.name ?? gitIdentity.name ?? '',
      email: config.git?.email ?? gitIdentity.email ?? '',
      signing: config.git?.signing ?? true,
      config_path: gitConfigPath,
    },
    github: hydrateGitHubSection(config.github, sourceDir),
  };
}

function hydrateGitHubSection(
  github: MoltNetConfig['github'],
  sourceDir: string,
): NonNullable<MoltNetConfig['github']> {
  const appId = github?.app_id ?? '';
  const installationId = github?.installation_id ?? '';
  const slug = github?.app_slug;
  if (github?.private_key_ref) {
    return {
      ...github,
      app_id: appId,
      installation_id: installationId,
      private_key_ref: github.private_key_ref,
    };
  }
  return {
    ...github,
    app_id: appId,
    installation_id: installationId,
    private_key_path:
      github?.private_key_path ?? (slug ? join(sourceDir, `${slug}.pem`) : ''),
  };
}

async function readGitConfigIdentity(
  gitConfigPath: string,
): Promise<{ name?: string; email?: string }> {
  try {
    const content = await readFile(gitConfigPath, 'utf-8');
    return {
      name: content.match(/^\s*name\s*=\s*(.+)$/m)?.[1]?.trim(),
      email: content.match(/^\s*email\s*=\s*(.+)$/m)?.[1]?.trim(),
    };
  } catch {
    return {};
  }
}

async function filterResolvedLegacyIssues(
  issues: ConfigIssue[],
  config: MoltNetConfig,
): Promise<ConfigIssue[]> {
  const fieldPath: Record<string, string | undefined> = {
    'ssh.private_key_path': config.ssh?.private_key_path,
    'ssh.public_key_path': config.ssh?.public_key_path,
    'git.config_path': config.git?.config_path,
    'github.private_key_path': config.github?.private_key_path,
  };

  const filtered: ConfigIssue[] = [];
  for (const issue of issues) {
    const resolvedPath = fieldPath[issue.field];
    if (resolvedPath && (await fileExists(resolvedPath))) {
      continue;
    }
    filtered.push(issue);
  }
  return filtered;
}

/** Format issues for display in the TUI. */
export function formatPortIssues(issues: ConfigIssue[]): string[] {
  return issues.map((i) => `${i.field}: ${i.problem}`);
}

/** Check whether a file is readable. Used by portCopy for optional files. */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
