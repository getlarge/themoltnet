#!/usr/bin/env node
/**
 * Export Ory Network configuration and restorable resources into a portable
 * backup bundle.
 *
 * The Ory CLI breaks when both workspace and project API keys are present, so
 * this script runs config exports with the workspace key and data exports with
 * the project key.
 *
 * Usage:
 *   npx @dotenvx/dotenvx run -f env.public -f .env -- node infra/ory/backup.mjs
 *
 *   ORY_JWK_SET_IDS=hydra.jwt.access-token \
 *   ORY_BACKUP_PASSPHRASE='...' \
 *   npx @dotenvx/dotenvx run -f env.public -f .env -- \
 *     node infra/ory/backup.mjs --output-dir .ory-backups/manual
 */

import { execFileSync } from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

function fatal(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(message);
}

function parseArgs(argv) {
  const args = {
    outputDir: resolve(process.cwd(), '.ory-backups', timestamp()),
    pageSize: 500,
    jwkSetIds: [],
    encryptPassphraseEnv: 'ORY_BACKUP_PASSPHRASE',
    skipEncryption: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--output-dir':
        if (!next) fatal('--output-dir requires a value');
        args.outputDir = resolve(process.cwd(), next);
        index += 1;
        break;
      case '--page-size':
        if (!next) fatal('--page-size requires a value');
        args.pageSize = Number(next);
        index += 1;
        break;
      case '--jwk-set':
        if (!next) fatal('--jwk-set requires a value');
        args.jwkSetIds.push(next);
        index += 1;
        break;
      case '--encrypt-passphrase-env':
        if (!next) fatal('--encrypt-passphrase-env requires a value');
        args.encryptPassphraseEnv = next;
        index += 1;
        break;
      case '--skip-encryption':
        args.skipEncryption = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        fatal(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.pageSize) || args.pageSize <= 0) {
    fatal('--page-size must be a positive integer');
  }

  const envJwkSetIds = (process.env.ORY_JWK_SET_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  args.jwkSetIds = [...new Set([...args.jwkSetIds, ...envJwkSetIds])];

  return args;
}

function printHelp() {
  console.log(`Export Ory Network configuration and resources.

Flags:
  --output-dir <path>            Output directory (default: .ory-backups/<utc>)
  --page-size <n>                Page size for list operations (default: 500)
  --jwk-set <id>                 JWK set ID to export (repeatable)
  --encrypt-passphrase-env <env> Env var containing bundle passphrase
  --skip-encryption              Write only plaintext files + tar.gz archive
  --help                         Show this help

Env:
  ORY_PROJECT_ID                 Required
  ORY_WORKSPACE_API_KEY          Required for config export
  ORY_PROJECT_API_KEY            Required for identities/clients/JWK/tuples
  ORY_JWK_SET_IDS                Optional comma-separated JWK set IDs
  ORY_BACKUP_PASSPHRASE          Optional encryption passphrase
`);
}

function timestamp() {
  return new Date().toISOString().replaceAll(':', '-');
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fatal(`${name} must be set`);
  return value;
}

function buildOryEnv(mode) {
  const env = { ...process.env };

  // Avoid the repo-root encrypted .env being auto-loaded by the CLI.
  delete env.ORY_PROJECT_API_KEY;
  delete env.ORY_WORKSPACE_API_KEY;

  if (mode === 'config') {
    env.ORY_WORKSPACE_API_KEY = requireEnv('ORY_WORKSPACE_API_KEY');
  } else {
    env.ORY_PROJECT_API_KEY = requireEnv('ORY_PROJECT_API_KEY');
  }

  return env;
}

function runOry(args, { mode } = {}) {
  return execFileSync('ory', args, {
    cwd: '/tmp',
    env: buildOryEnv(mode),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseJson(stdout, commandLabel) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    fatal(`${commandLabel} did not return valid JSON: ${error.message}`);
  }
}

function extractItems(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  const maybeSingleResourceKeys = ['id', 'client_id', 'namespace'];
  if (maybeSingleResourceKeys.some((key) => key in value)) {
    return [value];
  }

  const preferredKeys = [
    'items',
    'identities',
    'oauth2_clients',
    'oauth2Clients',
    'relation_tuples',
    'relationTuples',
    'relationships',
    'data',
  ];

  for (const key of preferredKeys) {
    if (Array.isArray(value[key])) return value[key];
  }

  const arrayValues = Object.values(value).filter(Array.isArray);
  return arrayValues.length === 1 ? arrayValues[0] : [];
}

function extractNextPageToken(value) {
  if (!value || typeof value !== 'object') return undefined;

  return (
    value.next_page_token ??
    value.nextPageToken ??
    value.page_info?.next_page_token ??
    value.pageInfo?.nextPageToken ??
    value.pagination?.next_page_token ??
    value.pagination?.nextPageToken
  );
}

function listAllPages({ label, command, mode, pageSize, outputDir }) {
  const pageDir = join(outputDir, 'raw-pages');
  ensureDir(pageDir);

  const pages = [];
  const items = [];
  let pageToken;
  let pageIndex = 1;

  while (true) {
    const args = [...command, '--page-size', String(pageSize), '--format', 'json'];
    if (pageToken) args.push('--page-token', pageToken);

    const stdout = runOry(args, { mode });
    const parsed = parseJson(stdout, label);
    const pageItems = extractItems(parsed);
    const nextPageToken = extractNextPageToken(parsed);

    pages.push({
      page: pageIndex,
      itemCount: pageItems.length,
      nextPageToken: nextPageToken ?? null,
    });
    items.push(...pageItems);

    writeJson(join(pageDir, `${String(pageIndex).padStart(4, '0')}.json`), parsed);

    if (!nextPageToken) break;
    if (nextPageToken === pageToken) {
      fatal(`${label} returned the same page token twice`);
    }

    pageToken = nextPageToken;
    pageIndex += 1;
  }

  return { items, pages };
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function fetchDetailedResources({
  ids,
  getCommand,
  outputPath,
  mode,
  extraArgs = [],
}) {
  if (ids.length === 0) {
    writeJson(outputPath, []);
    return [];
  }

  const details = [];
  for (const idChunk of chunk(ids, 50)) {
    const stdout = runOry(
      [...getCommand, ...idChunk, ...extraArgs, '--format', 'json'],
      { mode },
    );
    const parsed = parseJson(stdout, getCommand.join(' '));
    details.push(...extractItems(parsed));
  }

  writeJson(outputPath, details);
  return details;
}

function exportJson({ path, command, mode }) {
  const stdout = runOry([...command, '--format', 'json'], { mode });
  const parsed = parseJson(stdout, command.join(' '));
  writeJson(path, parsed);
  return parsed;
}

function encryptBundleMetadata({ salt, iv, tag }) {
  return {
    type: 'ory-backup-bundle',
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    archive: 'tar.gz',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function createArchive({ outputDir, archivePath }) {
  execFileSync(
    'tar',
    [
      '-czf',
      archivePath,
      'metadata.json',
      'README.txt',
      'config',
      'resources',
      'restore',
    ],
    {
      cwd: outputDir,
      stdio: 'inherit',
    },
  );
}

async function encryptArchive({ archivePath, encryptedPath, metadataPath, passphrase }) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const input = createReadStream(archivePath);
  const output = createWriteStream(encryptedPath);

  await pipeline(input, cipher, output);

  writeJson(
    metadataPath,
    encryptBundleMetadata({ salt, iv, tag: cipher.getAuthTag() }),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = requireEnv('ORY_PROJECT_ID');
  const passphrase = process.env[args.encryptPassphraseEnv];

  rmSync(args.outputDir, { recursive: true, force: true });
  ensureDir(args.outputDir);

  const configDir = join(args.outputDir, 'config');
  const resourcesDir = join(args.outputDir, 'resources');
  const restoreDir = join(args.outputDir, 'restore');
  ensureDir(configDir);
  ensureDir(resourcesDir);
  ensureDir(restoreDir);

  log(`Exporting Ory project ${projectId} into ${args.outputDir}`);

  const metadata = {
    exportedAt: new Date().toISOString(),
    projectId,
    pageSize: args.pageSize,
    jwkSetIds: args.jwkSetIds,
    oryVersion: runOry(['version'], { mode: 'config' }).trim(),
  };

  exportJson({
    path: join(configDir, 'project.json'),
    command: ['get', 'project', projectId],
    mode: 'config',
  });
  exportJson({
    path: join(configDir, 'identity-config.json'),
    command: ['get', 'identity-config', '--project', projectId],
    mode: 'config',
  });
  exportJson({
    path: join(configDir, 'oauth2-config.json'),
    command: ['get', 'oauth2-config', '--project', projectId],
    mode: 'config',
  });
  exportJson({
    path: join(configDir, 'permission-config.json'),
    command: ['get', 'permission-config', '--project', projectId],
    mode: 'config',
  });
  writeFileSync(
    join(configDir, 'permissions.opl.ts'),
    readFileSync(join(__dirname, 'permissions.ts'), 'utf8'),
  );

  const identitiesDir = join(resourcesDir, 'identities');
  ensureDir(identitiesDir);
  const identityPages = listAllPages({
    label: 'ory list identities',
    command: ['list', 'identities'],
    mode: 'data',
    pageSize: args.pageSize,
    outputDir: identitiesDir,
  });
  const identityIds = identityPages.items
    .map((identity) => identity?.id)
    .filter((value) => typeof value === 'string');
  const identityDetails =
    identityIds.length === identityPages.items.length
      ? fetchDetailedResources({
          ids: identityIds,
          getCommand: ['get', 'identity'],
          extraArgs: ['--include-credentials', 'oidc'],
          mode: 'data',
          outputPath: join(restoreDir, 'identities.import.json'),
        })
      : identityPages.items;
  writeJson(join(identitiesDir, 'index.json'), {
    total: identityPages.items.length,
    pages: identityPages.pages,
  });
  if (identityIds.length !== identityPages.items.length) {
    writeJson(join(restoreDir, 'identities.import.json'), identityPages.items);
  }

  const clientsDir = join(resourcesDir, 'oauth2-clients');
  ensureDir(clientsDir);
  const clientPages = listAllPages({
    label: 'ory list oauth2-clients',
    command: ['list', 'oauth2-clients'],
    mode: 'data',
    pageSize: args.pageSize,
    outputDir: clientsDir,
  });
  const clientIds = clientPages.items
    .map((client) => client?.client_id ?? client?.clientId ?? client?.id)
    .filter((value) => typeof value === 'string');
  const clientDetails =
    clientIds.length === clientPages.items.length
      ? fetchDetailedResources({
          ids: clientIds,
          getCommand: ['get', 'oauth2-client'],
          mode: 'data',
          outputPath: join(restoreDir, 'oauth2-clients.raw.json'),
        })
      : clientPages.items;
  writeJson(join(restoreDir, 'oauth2-clients.import.json'), clientDetails);
  writeJson(join(clientsDir, 'index.json'), {
    total: clientPages.items.length,
    pages: clientPages.pages,
  });

  const tuplesDir = join(resourcesDir, 'relationship-tuples');
  ensureDir(tuplesDir);
  const tuplePages = listAllPages({
    label: 'ory list relationships',
    command: ['list', 'relationships'],
    mode: 'data',
    pageSize: args.pageSize,
    outputDir: tuplesDir,
  });
  writeJson(join(restoreDir, 'relationship-tuples.json'), tuplePages.items);
  writeJson(join(tuplesDir, 'index.json'), {
    total: tuplePages.items.length,
    pages: tuplePages.pages,
  });

  const jwkManifest = [];
  if (args.jwkSetIds.length > 0) {
    const jwkDir = join(resourcesDir, 'jwks');
    ensureDir(jwkDir);

    for (const setId of args.jwkSetIds) {
      exportJson({
        path: join(jwkDir, `${setId}.json`),
        command: ['get', 'jwk', setId],
        mode: 'data',
      });
      jwkManifest.push({ setId, exported: true });
    }
  }

  metadata.counts = {
    identities: identityDetails.length,
    oauth2Clients: clientDetails.length,
    relationshipTuples: tuplePages.items.length,
    jwkSets: jwkManifest.length,
  };
  metadata.warnings = [
    clientDetails.length > 0
      ? 'OAuth2 client secrets are not exported by Ory; restore requires post-import secret rotation'
      : null,
    args.jwkSetIds.length === 0
      ? 'No JWK set IDs were provided; private signing keys were not exported'
      : null,
  ].filter(Boolean);

  writeJson(join(args.outputDir, 'metadata.json'), metadata);

  writeFileSync(
    join(args.outputDir, 'README.txt'),
    [
      `Ory backup bundle created at ${metadata.exportedAt}`,
      `Project ID: ${projectId}`,
      `Identities: ${metadata.counts.identities}`,
      `OAuth2 clients: ${metadata.counts.oauth2Clients}`,
      `Relationship tuples: ${metadata.counts.relationshipTuples}`,
      `JWK sets: ${metadata.counts.jwkSets}`,
      '',
      'Important:',
      '- bundle.tar.gz is the plaintext archive for local inspection.',
      '- bundle.tar.gz.enc plus bundle.tar.gz.enc.metadata.json are the encrypted artifacts intended for off-repo storage.',
      '- restore/oauth2-clients.import.json contains client definitions only; rotate secrets after restore.',
      '- sessions, consent grants, active tokens, and other transient runtime state are not exported by this script.',
      '',
    ].join('\n'),
  );

  const archivePath = join(args.outputDir, 'bundle.tar.gz');
  createArchive({ outputDir: args.outputDir, archivePath });

  if (!args.skipEncryption) {
    if (!passphrase) {
      fatal(
        `${args.encryptPassphraseEnv} must be set unless --skip-encryption is used`,
      );
    }

    await encryptArchive({
      archivePath,
      encryptedPath: join(args.outputDir, 'bundle.tar.gz.enc'),
      metadataPath: join(args.outputDir, 'bundle.tar.gz.enc.metadata.json'),
      passphrase,
    });
  }

  log(`Backup complete: ${args.outputDir}`);
  if (metadata.warnings.length > 0) {
    for (const warning of metadata.warnings) {
      log(`WARNING: ${warning}`);
    }
  }
}

main().catch((error) => fatal(error instanceof Error ? error.message : String(error)));
