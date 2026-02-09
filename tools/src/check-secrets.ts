/**
 * Preflight check: verify that all required env vars are present
 * in the deployment target (e.g. Fly.io secrets).
 *
 * Usage:
 *   flyctl secrets list --json | jq -r '.[].Name' | tsx src/check-secrets.ts
 *   flyctl secrets list --json | jq -r '.[].Name' | tsx src/check-secrets.ts --app mcp-server
 *   tsx src/check-secrets.ts SECRET_A SECRET_B SECRET_C
 */

import { getRequiredSecrets as getMcpServerSecrets } from '@moltnet/mcp-server';
import { getRequiredSecrets as getRestApiSecrets } from '@moltnet/rest-api';

const appResolvers: Record<string, () => string[]> = {
  'rest-api': getRestApiSecrets,
  'mcp-server': getMcpServerSecrets,
};

const appFlagIndex = process.argv.indexOf('--app');
const appName =
  appFlagIndex !== -1 ? process.argv[appFlagIndex + 1] : 'rest-api';
const argsWithoutFlag =
  appFlagIndex !== -1
    ? [
        ...process.argv.slice(2, appFlagIndex),
        ...process.argv.slice(appFlagIndex + 2),
      ]
    : process.argv.slice(2);

const resolver = appResolvers[appName];
if (!resolver) {
  console.error(
    `Unknown app: ${appName}. Available: ${Object.keys(appResolvers).join(', ')}`,
  );
  process.exit(1);
}

const required = resolver();

let deployed: string[];
if (argsWithoutFlag.length > 0) {
  deployed = argsWithoutFlag;
} else {
  const stdin = await new Promise<string>((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
  deployed = stdin.trim().split(/\s+/).filter(Boolean);
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
