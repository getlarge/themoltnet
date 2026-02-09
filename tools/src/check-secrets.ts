/**
 * Preflight check: verify that all required env vars are present
 * in the deployment target (e.g. Fly.io secrets).
 *
 * Usage:
 *   flyctl secrets list --json | jq -r '.[].Name' | tsx src/check-secrets.ts
 *   tsx src/check-secrets.ts SECRET_A SECRET_B SECRET_C
 */

import { getRequiredSecrets } from '@moltnet/rest-api';

const required = getRequiredSecrets();

let deployed: string[];
if (process.argv.length > 2) {
  deployed = process.argv.slice(2);
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
  console.error(`Missing required secrets: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`All ${required.length} required secrets present`);
