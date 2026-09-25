#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const [bundleRoot, outputDir, mode] = process.argv.slice(2);
if (!bundleRoot || !outputDir || !['candidate', 'published'].includes(mode)) {
  throw new Error(
    'Usage: self-host-smoke-prepare.mjs <bundle-root> <output-dir> <candidate|published>',
  );
}

const source = path.resolve(bundleRoot, 'deploy/self-host');
const input = readFileSync(path.join(source, '.env.example'), 'utf8');
const filled = input.replace(/^([A-Z][A-Z0-9_]*)=$/gm, (_, name) => {
  if (name === 'SMTP_CONNECTION_URI') return `${name}=smtp://localhost:1025/`;
  if (name === 'ACME_EMAIL') return `${name}=ci@example.com`;
  if (name === 'OTLP_ENDPOINT') return `${name}=`;
  if (name.endsWith('_IMAGE')) return `${name}=ci-placeholder`;
  return `${name}=${randomBytes(name === 'KRATOS_CIPHER_SECRET' ? 16 : 32).toString('hex')}`;
});
writeFileSync(path.join(outputDir, 'self-host-smoke.env'), filled, {
  mode: 0o600,
});

const caddy = readFileSync(path.join(source, 'Caddyfile'), 'utf8');
const localCaddy = caddy.replace(
  'email {$ACME_EMAIL}',
  'email {$ACME_EMAIL}\n\tlocal_certs',
);
if (localCaddy === caddy)
  throw new Error('Could not enable local Caddy certificates');
writeFileSync(path.join(source, 'Caddyfile.smoke'), localCaddy);

if (mode === 'candidate') {
  const workspace = JSON.parse(
    readFileSync(path.join(repoRoot, 'nx.json'), 'utf8'),
  );
  const registry = workspace.release?.docker?.registryUrl;
  const image = (project) => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, project, 'package.json'), 'utf8'),
    );
    return `${registry}/${packageJson.nx.release.docker.repositoryName}:dev`;
  };
  writeFileSync(
    path.join(outputDir, 'self-host-candidate.env'),
    `REST_API_IMAGE=${image('apps/rest-api')}\nMCP_SERVER_IMAGE=${image('apps/mcp-server')}\n`,
    { mode: 0o600 },
  );
}
