/**
 * Preflight check: verify that all required env vars are present
 * in the deployment target (Fly.io secrets + fly.toml env).
 *
 * Usage:
 *   flyctl secrets list --json | jq -r '.[].Name' | tsx src/check-secrets.ts --fly-toml apps/rest-api/fly.toml
 *   flyctl secrets list --json | jq -r '.[].Name' | tsx src/check-secrets.ts --app mcp-server --fly-toml apps/mcp-server/fly.toml
 *   tsx src/check-secrets.ts SECRET_A SECRET_B SECRET_C
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { getRequiredSecrets as getMcpServerSecrets } from '@moltnet/mcp-server';
import { getRequiredSecrets as getRestApiSecrets } from '@moltnet/rest-api';
import { parse } from 'smol-toml';

const appResolvers: Record<string, () => string[]> = {
  'rest-api': getRestApiSecrets,
  'mcp-server': getMcpServerSecrets,
};

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    app: { type: 'string', default: 'rest-api' },
    'fly-toml': { type: 'string' },
  },
  allowPositionals: true,
});

const appName = values.app!;
const resolver = appResolvers[appName];
if (!resolver) {
  console.error(
    `Unknown app: ${appName}. Available: ${Object.keys(appResolvers).join(', ')}`,
  );
  process.exit(1);
}

const required = resolver();

// Collect deployed env var names from stdin (flyctl secrets) or positional args
let deployed: string[];
if (positionals.length > 0) {
  deployed = positionals;
} else {
  const stdin = await new Promise<string>((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
  deployed = stdin.trim().split(/\s+/).filter(Boolean);
}

// Merge env vars from fly.toml if provided
if (values['fly-toml']) {
  // Resolve relative to INIT_CWD (where pnpm was invoked) so paths like
  // "apps/rest-api/fly.toml" work regardless of workspace cwd
  const base = process.env.INIT_CWD ?? process.cwd();
  const tomlPath = resolve(base, values['fly-toml']);
  const toml = parse(readFileSync(tomlPath, 'utf-8'));
  const envKeys = Object.keys((toml.env as Record<string, unknown>) ?? {});
  deployed.push(...envKeys);
}

const deployedSet = new Set(deployed);
const missing = required.filter((s) => !deployedSet.has(s));

if (missing.length > 0) {
  console.error(
    `Missing required secrets for ${appName}: ${missing.join(', ')}`,
  );
  process.exit(1);
}

console.log(`[${appName}] All ${required.length} required secrets present`);
