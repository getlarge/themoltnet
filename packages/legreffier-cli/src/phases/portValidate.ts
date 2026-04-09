import { access } from 'node:fs/promises';

import {
  type ConfigIssue,
  type MoltNetConfig,
  readConfig,
  repairConfig,
} from '@themoltnet/sdk';

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
 *  - `github.app_id` present and numeric, `github.app_slug`, `github.installation_id`
 *  - `ssh.private_key_path`, `ssh.public_key_path`, `git.config_path` set
 *  - `github.private_key_path` set
 *  - All four absolute paths (ssh priv/pub, git config, github pem) exist on disk
 *
 * Throws if `moltnet.json` is missing or unreadable — nothing to port.
 */
export async function runPortValidatePhase(opts: {
  sourceDir: string;
}): Promise<PortValidateResult> {
  const { sourceDir } = opts;

  const config = await readConfig(sourceDir);
  if (!config) {
    throw new Error(
      `No moltnet.json found in ${sourceDir} — nothing to port. ` +
        `Run \`legreffier\` on a repo first to create a source identity.`,
    );
  }

  // Generic SDK checks (identity_id, keys, endpoints, file paths, legacy
  // credentials.json migration). Dry-run so we don't mutate the source.
  const { issues: baseIssues } = await repairConfig({
    configDir: sourceDir,
    dryRun: true,
  });
  const issues: ConfigIssue[] = [...baseIssues];

  // Port-specific required fields
  if (!config.oauth2?.client_id) {
    issues.push({
      field: 'oauth2.client_id',
      problem: 'missing — required for port',
      action: 'warning',
    });
  }
  if (!config.oauth2?.client_secret) {
    issues.push({
      field: 'oauth2.client_secret',
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
  if (!config.github?.installation_id) {
    issues.push({
      field: 'github.installation_id',
      problem: 'missing — required for port',
      action: 'warning',
    });
  }
  if (!config.github?.private_key_path) {
    issues.push({
      field: 'github.private_key_path',
      problem: 'missing — required for port',
      action: 'warning',
    });
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

  // Block only on unresolved warnings. `fixed` (auto-repaired by repairConfig)
  // and `migrate` (advisory legacy format migration) are non-blocking by
  // definition — they represent state that is already corrected or will be
  // handled by the copy/rewrite phases.
  const blockingIssues = issues.filter((i) => i.action === 'warning');
  const canProceed = blockingIssues.length === 0;
  return { config, issues, canProceed };
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
