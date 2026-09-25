#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const [bundleRoot, outputDir] = process.argv.slice(2);
if (!bundleRoot || !outputDir) {
  throw new Error(
    'Usage: self-host-smoke-prepare.mjs <bundle-root> <output-dir>',
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
