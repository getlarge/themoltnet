import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  getConfigDir,
  type MoltNetConfig,
  writeConfig,
} from './credentials.js';

export interface ConfigIssue {
  field: string;
  problem: string;
  action: 'fixed' | 'warning' | 'migrate';
}

export interface RepairResult {
  issues: ConfigIssue[];
  config: MoltNetConfig | null;
}

/**
 * Validate and optionally repair a MoltNet config.
 *
 * Checks required fields, detects stale file paths, and migrates
 * `credentials.json` to `moltnet.json` when found.
 *
 * Pass `dryRun: true` to report issues without writing changes.
 */
export async function repairConfig(opts?: {
  configDir?: string;
  dryRun?: boolean;
}): Promise<RepairResult> {
  const dir = opts?.configDir ?? getConfigDir();
  const issues: ConfigIssue[] = [];

  // Try moltnet.json first, then credentials.json (without readConfig's
  // silent fallback, so we can detect and report the migration).
  let config = await tryReadJson(join(dir, 'moltnet.json'));
  if (!config) {
    const legacy = await tryReadJson(join(dir, 'credentials.json'));
    if (legacy) {
      config = legacy;
      issues.push({
        field: 'file',
        problem:
          'using deprecated credentials.json — will migrate to moltnet.json',
        action: 'migrate',
      });
      if (!opts?.dryRun) {
        await writeConfig(config, dir);
      }
    } else {
      return { issues: [], config: null };
    }
  }

  validateConfig(config, issues);
  await checkFilePaths(config, issues);

  // Apply auto-fixes
  if (!config.endpoints.mcp && config.endpoints.api) {
    config.endpoints.mcp = `${config.endpoints.api}/mcp`;
    issues.push({
      field: 'endpoints.mcp',
      problem: 'missing — derived from API endpoint',
      action: 'fixed',
    });
  }

  const hasAutoFixes = issues.some((i) => i.action === 'fixed');
  if (hasAutoFixes && !opts?.dryRun) {
    await writeConfig(config, dir);
  }

  return { issues, config };
}

function validateConfig(config: MoltNetConfig, issues: ConfigIssue[]): void {
  if (!config.identity_id) {
    issues.push({
      field: 'identity_id',
      problem: 'missing',
      action: 'warning',
    });
  }
  if (!config.keys.public_key) {
    issues.push({
      field: 'keys.public_key',
      problem: 'missing',
      action: 'warning',
    });
  }
  if (!config.keys.private_key) {
    issues.push({
      field: 'keys.private_key',
      problem: 'missing',
      action: 'warning',
    });
  }
  if (
    config.keys.public_key &&
    !config.keys.public_key.startsWith('ed25519:')
  ) {
    issues.push({
      field: 'keys.public_key',
      problem: "missing 'ed25519:' prefix",
      action: 'warning',
    });
  }
  if (!config.endpoints.api) {
    issues.push({
      field: 'endpoints.api',
      problem: 'missing',
      action: 'warning',
    });
  }
}

async function checkFilePaths(
  config: MoltNetConfig,
  issues: ConfigIssue[],
): Promise<void> {
  const checks: { field: string; path: string }[] = [];

  if (config.ssh?.private_key_path) {
    checks.push({
      field: 'ssh.private_key_path',
      path: config.ssh.private_key_path,
    });
  }
  if (config.ssh?.public_key_path) {
    checks.push({
      field: 'ssh.public_key_path',
      path: config.ssh.public_key_path,
    });
  }
  if (config.git?.config_path) {
    checks.push({ field: 'git.config_path', path: config.git.config_path });
  }
  if (config.github?.private_key_path) {
    checks.push({
      field: 'github.private_key_path',
      path: config.github.private_key_path,
    });
  }

  for (const { field, path } of checks) {
    try {
      await access(path);
    } catch {
      issues.push({
        field,
        problem: `file not found: ${path}`,
        action: 'warning',
      });
    }
  }
}

async function tryReadJson(path: string): Promise<MoltNetConfig | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as MoltNetConfig;
  } catch {
    return null;
  }
}
