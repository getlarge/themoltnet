#!/usr/bin/env node
// Synthetic lifecycle test: no live environment files, credentials, or host ports.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'ory-module-smoke-'));
const project = `ory-module-smoke-${randomBytes(6).toString('hex')}`;
const moduleFile = path.join(root, 'deploy/ory/compose.yaml');
const names = [
  'ory-db-init',
  'kratos-migrate',
  'hydra-migrate',
  'keto-migrate',
  'talos-init',
  'talos-migrate',
  'kratos',
  'hydra',
  'keto',
  'talos',
];
const composeFile = path.join(temporary, 'compose.yaml');
const envFile = path.join(temporary, 'synthetic.env');
const example = readFileSync(
  path.join(root, 'deploy/self-host/.env.example'),
  'utf8',
);
const env = example.replace(
  /^([A-Z][A-Z0-9_]*)=$/gm,
  (_, key) =>
    `${key}=${key === 'SMTP_CONNECTION_URI' ? 'smtp://localhost:1025/' : randomBytes(key === 'KRATOS_CIPHER_SECRET' ? 16 : 32).toString('hex')}`,
);
writeFileSync(envFile, env, { mode: 0o600 });
writeFileSync(
  composeFile,
  `services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    healthcheck:
      test: [CMD-SHELL, 'pg_isready -h 127.0.0.1 -U postgres -d postgres']
      interval: 2s
      timeout: 3s
      retries: 30
    networks: [database]
${names.map((name) => `  ${name}:\n    extends:\n      file: ${JSON.stringify(moduleFile)}\n      service: ${name}\n`).join('')}
networks:
  ingress:
  database:
    internal: true
  services:
    internal: true
  identity:
    internal: true
  credentials:
    internal: true
volumes:
  talos-data:
`,
);
const args = [
  'compose',
  '-p',
  project,
  '--env-file',
  envFile,
  '--env-file',
  path.join(root, 'deploy/self-host/.env.release'),
  '-f',
  composeFile,
];
const dockerEnv = Object.fromEntries(
  [
    'PATH',
    'HOME',
    'DOCKER_CONFIG',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
  ]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
const run = (command, capture = false) => {
  try {
    const result = execFileSync('docker', [...args, ...command], {
      encoding: 'utf8',
      env: dockerEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!capture)
      console.log(
        `Passed Compose operation: ${command.filter((part) => !part.startsWith('-')).join(' ')}`,
      );
    return result;
  } catch {
    throw new Error(`Synthetic Compose operation failed: ${command[0]}`);
  }
};
const sql = (query) =>
  run(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-Atqc',
      query,
    ],
    true,
  ).trim();
const talosState = () =>
  run(
    [
      'exec',
      '-T',
      'talos',
      'sh',
      '-ec',
      'sha256sum /var/lib/talos/jwks.json /var/lib/talos/hmac-secret',
    ],
    true,
  );
let started = false;
try {
  console.log(`Synthetic Ory module project: ${project}`);
  started = true;
  run(['up', '-d', '--wait', '--wait-timeout', '120', 'postgres']);
  // Represent an existing application database. Provisioning must preserve it.
  sql('CREATE ROLE application LOGIN');
  sql('CREATE DATABASE application OWNER application');
  run(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'application',
      '-c',
      'CREATE TABLE retained (id integer PRIMARY KEY); INSERT INTO retained VALUES (17)',
    ],
    true,
  );
  const before = sql(
    "SELECT datname || ':' || pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'application'",
  );
  run(['run', '--rm', '--no-deps', 'ory-db-init']);
  const passwordHashes = sql(
    "SELECT rolname || ':' || md5(rolpassword) FROM pg_authid WHERE rolname IN ('kratos', 'hydra', 'keto') ORDER BY rolname",
  );
  run(['run', '--rm', '--no-deps', 'ory-db-init']);
  assert.equal(
    sql(
      "SELECT rolname || ':' || md5(rolpassword) FROM pg_authid WHERE rolname IN ('kratos', 'hydra', 'keto') ORDER BY rolname",
    ),
    passwordHashes,
  );
  assert.equal(
    run(
      [
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'postgres',
        '-d',
        'application',
        '-Atqc',
        'SELECT id FROM retained',
      ],
      true,
    ).trim(),
    '17',
  );
  assert.equal(
    sql(
      "SELECT datname || ':' || pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'application'",
    ),
    before,
  );
  assert.equal(
    sql(
      "SELECT count(*) FROM pg_database WHERE datname IN ('kratos', 'hydra', 'keto')",
    ),
    '3',
  );
  run(['run', '--rm', '--no-deps', 'talos-init']);
  for (const name of [
    'kratos-migrate',
    'hydra-migrate',
    'keto-migrate',
    'talos-migrate',
  ])
    run(['run', '--rm', '--no-deps', name]);
  run([
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '180',
    'kratos',
    'hydra',
    'keto',
    'talos',
  ]);
  const keys = talosState();
  run(['restart', 'talos']);
  assert.equal(talosState(), keys);
  const failedInit = (() => {
    try {
      run(['run', '--rm', '--no-deps', 'talos-init'], true);
      return false;
    } catch {
      return true;
    }
  })();
  assert.ok(failedInit, 'established Talos volume must refuse initialization');
  assert.equal(talosState(), keys);
  console.log(
    'Passed: populated PostgreSQL 17 preserved; Ory ready; Talos keys stable on restart and refused reinitialization',
  );
} finally {
  if (started) run(['--profile', '*', 'down', '-v', '--remove-orphans']);
  rmSync(temporary, { recursive: true, force: true });
}
