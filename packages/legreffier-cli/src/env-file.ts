import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export interface WriteEnvFileOptions {
  envDir: string;
  agentName: string;
  prefix: string;
  clientId: string;
  clientSecret: string;
  appId: string;
  pemPath: string;
  installationId: string;
}

/**
 * Parse a dotenv-format string using Node.js built-in `util.parseEnv`.
 * Handles quoting, comments, and blank lines.
 */
export function parseEnvFile(
  content: string,
): Record<string, string | undefined> {
  return parseEnv(content);
}

function q(v: string): string {
  return `'${v.replace(/'/g, "'\\''")}'`;
}

/**
 * Write or merge agent env vars into .moltnet/<agent>/env.
 * Managed keys (prefixed + GIT_CONFIG_GLOBAL) are updated;
 * user-added vars and comments are preserved.
 */
export async function writeEnvFile(opts: WriteEnvFileOptions): Promise<void> {
  await mkdir(opts.envDir, { recursive: true });
  const envPath = join(opts.envDir, 'env');

  const managedEntries: [string, string][] = [
    [`${opts.prefix}_CLIENT_ID`, q(opts.clientId)],
    [`${opts.prefix}_CLIENT_SECRET`, q(opts.clientSecret)],
    [`${opts.prefix}_GITHUB_APP_ID`, q(opts.appId)],
    [`${opts.prefix}_GITHUB_APP_PRIVATE_KEY_PATH`, q(opts.pemPath)],
    [`${opts.prefix}_GITHUB_APP_INSTALLATION_ID`, q(opts.installationId)],
    ['GIT_CONFIG_GLOBAL', q(`.moltnet/${opts.agentName}/gitconfig`)],
    ['MOLTNET_AGENT_NAME', q(opts.agentName)],
  ];
  const managedKeys = new Set(managedEntries.map(([k]) => k));

  let existingLines: string[] = [];
  try {
    const existing = await readFile(envPath, 'utf-8');
    existingLines = existing.split('\n');
  } catch {
    // File doesn't exist — start fresh
  }

  const outputLines: string[] = [];

  // Write managed vars first
  for (const [key, val] of managedEntries) {
    outputLines.push(`${key}=${val}`);
  }

  // Preserve user content: comments and non-managed vars
  let seenUserContent = false;
  for (const line of existingLines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      if (seenUserContent) outputLines.push(line);
      continue;
    }
    if (trimmed.startsWith('#')) {
      if (!seenUserContent) outputLines.push(''); // separator
      seenUserContent = true;
      outputLines.push(line);
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx);
    if (managedKeys.has(key)) continue; // skip — already written above
    if (!seenUserContent) outputLines.push(''); // separator
    seenUserContent = true;
    outputLines.push(line);
  }

  await writeFile(envPath, outputLines.join('\n') + '\n', 'utf-8');
}

/**
 * Update a single managed key in an existing env file.
 * If the key exists, its value is replaced; otherwise appended.
 */
export async function updateEnvVar(
  envDir: string,
  key: string,
  value: string,
): Promise<void> {
  const envPath = join(envDir, 'env');
  let content: string;
  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    content = '';
  }

  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${q(value)}`;

  if (pattern.test(content)) {
    content = content.replace(pattern, line);
  } else {
    content = content.endsWith('\n')
      ? content + line + '\n'
      : content + '\n' + line + '\n';
  }

  await writeFile(envPath, content, 'utf-8');
}

/**
 * Resolve the human operator's git identity from global git config.
 * Must be called BEFORE GIT_CONFIG_GLOBAL is set (so it reads the
 * human's config, not the agent's).
 *
 * Returns `"Name <email>"` or `null` if either is missing.
 */
export function resolveHumanGitIdentity(): string | null {
  try {
    const name = execFileSync('git', ['config', '--global', 'user.name'], {
      encoding: 'utf-8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: undefined },
    }).trim();
    const email = execFileSync('git', ['config', '--global', 'user.email'], {
      encoding: 'utf-8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: undefined },
    }).trim();
    return name && email ? `${name} <${email}>` : null;
  } catch {
    return null;
  }
}

/**
 * Append MOLTNET_HUMAN_GIT_IDENTITY and optionally MOLTNET_COMMIT_AUTHORSHIP
 * to an existing env file if not already present.
 * Preserves existing content — only appends new vars.
 */
export async function appendAuthorshipVars(
  envDir: string,
  humanGitIdentity?: string | null,
  commitAuthorship?: string,
): Promise<void> {
  const envPath = join(envDir, 'env');

  let existing = '';
  try {
    existing = await readFile(envPath, 'utf-8');
  } catch {
    return; // No env file to append to
  }

  const lines: string[] = [];

  const hasVar = (content: string, key: string): boolean =>
    new RegExp(`^${key}=`, 'm').test(content);

  if (humanGitIdentity && !hasVar(existing, 'MOLTNET_HUMAN_GIT_IDENTITY')) {
    lines.push(`MOLTNET_HUMAN_GIT_IDENTITY=${q(humanGitIdentity)}`);
  }

  if (commitAuthorship && !hasVar(existing, 'MOLTNET_COMMIT_AUTHORSHIP')) {
    lines.push(`MOLTNET_COMMIT_AUTHORSHIP=${q(commitAuthorship)}`);
  }

  if (lines.length === 0) return;

  const suffix = lines.join('\n') + '\n';
  const content = existing.endsWith('\n')
    ? existing + suffix
    : existing + '\n' + suffix;
  await writeFile(envPath, content, 'utf-8');
}
