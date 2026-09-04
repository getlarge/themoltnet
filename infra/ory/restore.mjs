#!/usr/bin/env node
/**
 * Restore Ory Network identities from an encrypted backup bundle produced by
 * infra/ory/backup.mjs.
 *
 * IMPORTANT — identity IDs cannot be preserved.
 *
 * Ory Kratos has no way to import an identity with a caller-chosen ID: the
 * admin create/import endpoint accepts `createIdentityBody`, which has no `id`
 * field, and the CLI strict-decodes the payload (`json: unknown field "id"`).
 * See https://github.com/ory/kratos/issues/2388 and discussion #2803 — Ory
 * consider this infeasible without breaking changes, and the only known
 * workaround is a forked self-hosted Kratos, which is not available on Ory
 * Network.
 *
 * Consequence: every restored identity gets a NEW UUID. Because
 * `agents.identity_id` is the primary key in Postgres and Keto tuples address
 * agents as `Agent:<identity_id>`, a restore MUST be followed by a remap of
 * those references. This script therefore emits an old -> new ID mapping
 * (`--map-out`) as its primary machine-readable output.
 *
 * Usage:
 *   node infra/ory/restore.mjs \
 *     --bundle .ory-backups/github-actions/bundle.tar.gz.enc \
 *     --target-project <project-id> \
 *     --mode plan
 */

import { execFileSync } from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

const ORY_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Fields accepted by Ory's `createIdentityBody`. The CLI strict-decodes, so any
 * other key exported by `ory get identity` (id, created_at, updated_at,
 * schema_url, organization_id ...) must be stripped or the import aborts.
 */
const IMPORTABLE_FIELDS = [
  'schema_id',
  'traits',
  'credentials',
  'state',
  'metadata_public',
  'metadata_admin',
];

function fatal(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(message);
}

function parseArgs(argv) {
  const args = {
    bundle: null,
    bundleMetadata: null,
    workDir: resolve(process.cwd(), '.ory-restore'),
    targetProject: process.env.ORY_RESTORE_TARGET_PROJECT ?? null,
    mode: 'plan',
    decryptPassphraseEnv: 'ORY_BACKUP_PASSPHRASE',
    mapOut: null,
    preserveVerifiedAddresses: true,
    preflightOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--bundle':
        if (!next) fatal('--bundle requires a value');
        args.bundle = resolve(process.cwd(), next);
        index += 1;
        break;
      case '--bundle-metadata':
        if (!next) fatal('--bundle-metadata requires a value');
        args.bundleMetadata = resolve(process.cwd(), next);
        index += 1;
        break;
      case '--work-dir':
        if (!next) fatal('--work-dir requires a value');
        args.workDir = resolve(process.cwd(), next);
        index += 1;
        break;
      case '--target-project':
        if (!next) fatal('--target-project requires a value');
        args.targetProject = next;
        index += 1;
        break;
      case '--mode':
        if (!next) fatal('--mode requires a value');
        if (!['plan', 'apply'].includes(next)) {
          fatal(`--mode must be plan or apply, got ${next}`);
        }
        args.mode = next;
        index += 1;
        break;
      case '--map-out':
        if (!next) fatal('--map-out requires a value');
        args.mapOut = resolve(process.cwd(), next);
        index += 1;
        break;
      case '--decrypt-passphrase-env':
        if (!next) fatal('--decrypt-passphrase-env requires a value');
        args.decryptPassphraseEnv = next;
        index += 1;
        break;
      case '--preflight-only':
        args.preflightOnly = true;
        break;
      case '--no-preserve-verified-addresses':
        args.preserveVerifiedAddresses = false;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        fatal(`Unknown argument: ${arg}`);
    }
  }

  if (!args.bundle && !args.preflightOnly) {
    fatal('--bundle is required');
  }
  if (!args.targetProject) fatal('--target-project is required');
  if (args.bundle && !args.bundleMetadata) {
    args.bundleMetadata = `${args.bundle}.metadata.json`;
  }
  if (!args.mapOut) args.mapOut = join(args.workDir, 'identity-id-map.json');

  return args;
}

function printHelp() {
  console.log(`Restore Ory identities from an encrypted backup bundle.

Flags:
  --bundle <path>                 Encrypted bundle (bundle.tar.gz.enc)
  --bundle-metadata <path>        Encryption metadata (default: <bundle>.metadata.json)
  --work-dir <path>               Scratch directory (default: .ory-restore)
  --target-project <id>           Ory project to restore into (required)
  --mode plan|apply               plan = diff only, no writes (default: plan)
  --map-out <path>                Where to write the old -> new ID mapping
  --decrypt-passphrase-env <env>  Env var holding the bundle passphrase
  --preflight-only                Verify tenant + list identities, then exit
  --no-preserve-verified-addresses  Let Kratos regenerate address state

Exit codes:
  0  success
  1  failure (bad passphrase, validation error, import error)
`);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Decrypt the bundle. AES-256-GCM authenticates the ciphertext, so a wrong
 * passphrase or a corrupted/truncated download surfaces here as an auth-tag
 * failure rather than as silent garbage.
 */
async function decryptBundle({ bundle, bundleMetadata, passphrase, outPath }) {
  const meta = readJson(bundleMetadata);

  if (meta.type !== 'ory-backup-bundle') {
    fatal(`Unexpected bundle type: ${meta.type}`);
  }
  if (meta.algorithm !== 'aes-256-gcm' || meta.kdf !== 'scrypt') {
    fatal(`Unsupported crypto: ${meta.algorithm}/${meta.kdf}`);
  }

  const salt = Buffer.from(meta.salt, 'base64');
  const iv = Buffer.from(meta.iv, 'base64');
  const tag = Buffer.from(meta.tag, 'base64');
  const key = scryptSync(passphrase, salt, 32);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  try {
    await pipeline(
      createReadStream(bundle),
      decipher,
      createWriteStream(outPath),
    );
  } catch (error) {
    rmSync(outPath, { force: true });
    fatal(
      'Bundle decryption failed (auth tag mismatch). The passphrase is wrong ' +
        `or the bundle is corrupt. Underlying error: ${error.message}`,
    );
  }

  return meta;
}

function extractBundle({ archivePath, destDir }) {
  ensureDir(destDir);
  execFileSync('tar', ['-xzf', archivePath, '-C', destDir], {
    stdio: 'inherit',
  });
}


/**
 * Preflight tenant check.
 *
 * For data operations the project API key alone selects the tenant, with no
 * --project flag to cross-check — the exact ambiguity that let an agent delete
 * production identities while believing it targeted stage. The project URL,
 * however, names the tenant unambiguously, and a project API key is scoped to
 * its own project: presenting it to a different project's URL is rejected.
 * Calling both together therefore proves key and intended tenant agree.
 */
async function verifyTenant({ projectUrl, expectedProject }) {
  const key = process.env.ORY_PROJECT_API_KEY;
  const response = await fetch(
    `${projectUrl.replace(/\/$/, '')}/admin/identities?page_size=1`,
    {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    fatal(
      `Tenant preflight failed: ${response.status} ${response.statusText} from ` +
        `${projectUrl}. The project API key does not belong to the project ` +
        `served at that URL, so it is NOT safe to assume it points at ` +
        `${expectedProject}. Refusing to continue.`,
    );
  }

  log(`Tenant preflight OK: project API key is valid for ${projectUrl}`);
}

/**
 * Ory Kratos admin API client.
 *
 * The Ory CLI is deliberately not used for data-plane work. It failed three
 * different ways against this project (rejects a blank credential var, stalls
 * indefinitely when handed a workspace key, and reports "Access credentials are
 * invalid" for a project key that the REST API accepts with 200). REST is
 * explicit about the tenant, returns real status codes, and can be exercised
 * locally before a CI run.
 */
async function oryFetch(path, { method = 'GET', body } = {}) {
  const base = requireProjectUrl();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.ORY_PROJECT_API_KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(ORY_REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `${method} ${path} -> ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
    );
  }

  return {
    data: text ? JSON.parse(text) : null,
    nextPageToken: parseNextPageToken(response.headers.get('link')),
  };
}

/**
 * Ory paginates with an opaque `page_token` advertised in the RFC 8288 Link
 * header. Guessing the token (e.g. reusing the last row's id) happens to work
 * on a single page and silently truncates on more than one, so parse what the
 * server actually said.
 */
function parseNextPageToken(linkHeader) {
  if (!linkHeader) return undefined;

  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (!match) continue;
    const token = new URL(match[1], 'https://placeholder.invalid').searchParams.get(
      'page_token',
    );
    if (token) return token;
  }

  return undefined;
}

function requireProjectUrl() {
  const url = process.env.ORY_PROJECT_URL;
  if (!url) fatal('ORY_PROJECT_URL must be set');
  return url.replace(/\/$/, '');
}

/** List every identity in the tenant, following Ory's page tokens. */
async function listTargetIdentities() {
  const identities = [];
  let pageToken;

  while (true) {
    const query = new URLSearchParams({ page_size: '500' });
    if (pageToken) query.set('page_token', pageToken);

    const { data, nextPageToken } = await oryFetch(`/admin/identities?${query}`);
    identities.push(...(Array.isArray(data) ? data : (data?.identities ?? [])));

    if (!nextPageToken || nextPageToken === pageToken) break;
    pageToken = nextPageToken;
  }

  return identities;
}

/** Stable business key used to match a backup identity to a live one. */
function identityKey(identity) {
  const traits = identity.traits ?? {};
  return (
    traits.email ??
    traits.username ??
    identity.metadata_public?.human_id ??
    identity.id
  );
}

/** Strip an exported identity down to what `ory import identities` accepts. */
function toImportBody(identity, { preserveVerifiedAddresses }) {
  const body = {};

  for (const field of IMPORTABLE_FIELDS) {
    if (identity[field] !== undefined && identity[field] !== null) {
      body[field] = identity[field];
    }
  }

  if (preserveVerifiedAddresses && identity.verifiable_addresses?.length) {
    // Only the value/verified/via/status subset is accepted; the exported
    // objects also carry ids and timestamps that would be rejected.
    body.verifiable_addresses = identity.verifiable_addresses.map(
      (address) => ({
        value: address.value,
        verified: address.verified === true,
        via: address.via,
        status: address.status,
      }),
    );
  }

  return body;
}

async function importIdentity({ body, workDir, index }) {
  // Keep the payload on disk: if Kratos rejects one, the exact body that was
  // sent is recoverable from the job artifacts.
  const payloadPath = join(
    workDir,
    `import-${String(index).padStart(3, '0')}.json`,
  );
  writeJson(payloadPath, body);

  const { data: created } = await oryFetch('/admin/identities', {
    method: 'POST',
    body,
  });

  if (!created?.id) {
    fatal(`Import returned no identity ID for payload ${payloadPath}`);
  }

  return created;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.preflightOnly) {
    const projectUrl = requireProjectUrl();
    await verifyTenant({
      projectUrl,
      expectedProject: args.targetProject,
    });
    const identities = await listTargetIdentities();
    log(`Identities currently in ${args.targetProject}: ${identities.length}`);
    for (const identity of identities) {
      log(`  ${identity.id}  ${identityKey(identity)}`);
    }
    return;
  }

  const passphrase = process.env[args.decryptPassphraseEnv];

  if (!passphrase) {
    fatal(`${args.decryptPassphraseEnv} must be set`);
  }
  if (!existsSync(args.bundle)) {
    fatal(`Bundle not found: ${args.bundle}`);
  }

  rmSync(args.workDir, { recursive: true, force: true });
  ensureDir(args.workDir);

  const archivePath = join(args.workDir, 'bundle.tar.gz');
  const extractDir = join(args.workDir, 'bundle');

  log('Decrypting bundle ...');
  await decryptBundle({
    bundle: args.bundle,
    bundleMetadata: args.bundleMetadata,
    passphrase,
    outPath: archivePath,
  });
  log('Decryption OK (auth tag verified).');

  extractBundle({ archivePath, destDir: extractDir });

  const bundleMeta = readJson(join(extractDir, 'metadata.json'));
  const identitiesPath = join(extractDir, 'restore', 'identities.import.json');

  if (!existsSync(identitiesPath)) {
    fatal(`Bundle is missing ${identitiesPath}`);
  }

  const backupIdentities = readJson(identitiesPath);

  log('');
  log(`Bundle exported at : ${bundleMeta.exportedAt}`);
  log(`Bundle project     : ${bundleMeta.projectId}`);
  log(`Identities in bundle: ${backupIdentities.length}`);
  log(`Target project     : ${args.targetProject}`);

  if (bundleMeta.projectId === args.targetProject) {
    log('Target matches the project the bundle was taken from.');
  } else {
    log('NOTE: target project differs from the bundle source project.');
  }

  const projectUrl = process.env.ORY_PROJECT_URL;
  if (!projectUrl) {
    fatal('ORY_PROJECT_URL must be set so the tenant can be verified');
  }
  log('');
  await verifyTenant({ projectUrl, expectedProject: args.targetProject });

  log('Listing identities in target project ...');
  const targetIdentities = await listTargetIdentities();
  const targetKeys = new Set(targetIdentities.map(identityKey));

  const missing = backupIdentities.filter((i) => !targetKeys.has(identityKey(i)));
  const conflicting = backupIdentities.filter((i) => targetKeys.has(identityKey(i)));

  log('');
  log(`Identities currently in target: ${targetIdentities.length}`);
  log(`To restore (missing)          : ${missing.length}`);
  log(`Already present (skipped)     : ${conflicting.length}`);

  if (conflicting.length > 0) {
    log('');
    log('These backup identities collide with a live identity on the target.');
    log('Kratos enforces unique credential identifiers, so they are skipped.');
    log('Delete the live identity first if you want the backup copy restored:');
    for (const identity of conflicting) {
      const live = targetIdentities.find((t) => identityKey(t) === identityKey(identity));
      log(`  ${identityKey(identity)}  backup=${identity.id}  live=${live?.id}`);
    }
  }

  const plan = {
    mode: args.mode,
    generatedAt: new Date().toISOString(),
    bundleExportedAt: bundleMeta.exportedAt,
    sourceProject: bundleMeta.projectId,
    targetProject: args.targetProject,
    counts: {
      inBundle: backupIdentities.length,
      inTargetBefore: targetIdentities.length,
      toRestore: missing.length,
      skippedConflicts: conflicting.length,
    },
    mappings: [],
  };

  if (args.mode === 'plan') {
    log('');
    log('PLAN MODE — no writes performed.');
    plan.mappings = missing.map((identity) => ({
      old_id: identity.id,
      new_id: null,
      key: identityKey(identity),
      human_id: identity.metadata_public?.human_id ?? null,
    }));
    writeJson(args.mapOut, plan);
    log(`Plan written to ${args.mapOut}`);
    return;
  }

  log('');
  log(`APPLY MODE — importing ${missing.length} identities ...`);

  let index = 0;
  for (const identity of missing) {
    index += 1;
    const body = toImportBody(identity, {
      preserveVerifiedAddresses: args.preserveVerifiedAddresses,
    });
    const created = await importIdentity({
      body,
      workDir: args.workDir,
      index,
    });

    plan.mappings.push({
      old_id: identity.id,
      new_id: created.id,
      key: identityKey(identity),
      human_id: identity.metadata_public?.human_id ?? null,
    });

    log(`  [${index}/${missing.length}] ${identityKey(identity)}: ${identity.id} -> ${created.id}`);
  }

  const after = await listTargetIdentities();
  plan.counts.inTargetAfter = after.length;

  writeJson(args.mapOut, plan);

  log('');
  log(`Restored ${plan.mappings.length} identities.`);
  log(`Target now has ${after.length} identities.`);
  log(`ID mapping written to ${args.mapOut}`);
  log('');
  log('NEXT: identity IDs changed. Remap references before the system is consistent:');
  log('  - Postgres: agents.identity_id (PK) and humans.identity_id');
  log('  - Keto    : tuples addressing Agent:<old_identity_id>');
}

main().catch((error) => {
  fatal(error?.stack ?? String(error));
});
