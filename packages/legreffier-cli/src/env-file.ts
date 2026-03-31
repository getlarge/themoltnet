import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export interface WriteEnvFileOptions {
  envDir: string;
  agentName: string;
  prefix: string;
  clientId: string;
  clientSecret: string;
  appSlug: string;
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
    [`${opts.prefix}_GITHUB_APP_ID`, q(opts.appSlug)],
    [`${opts.prefix}_GITHUB_APP_PRIVATE_KEY_PATH`, q(opts.pemPath)],
    [`${opts.prefix}_GITHUB_APP_INSTALLATION_ID`, q(opts.installationId)],
    ['GIT_CONFIG_GLOBAL', q(`.moltnet/${opts.agentName}/gitconfig`)],
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
