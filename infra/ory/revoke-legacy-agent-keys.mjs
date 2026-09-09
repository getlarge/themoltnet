#!/usr/bin/env node
/**
 * Revoke Talos agent keys still bound to a Kratos identity as their actor.
 *
 * Runs inside the maintenance window, AFTER the migration. MoltNet issues
 * agent keys with `actor_id: agents.id` and resolves them with
 * `agentRepository.findById(actor_id)` (bootstrap.ts `resolveTalosAgent`), so
 * once `agents.id` becomes a fresh UUID every key issued beforehand names an
 * actor no agent row claims.
 *
 * Rewriting those keys in place is not possible: Talos rejects `actor_id` in
 * the update mask outright —
 *
 *   400 unknown update_mask path: "actor_id"
 *       (allowed: name, scopes, metadata, rate_limit_policy, ip_restriction)
 *
 * and re-issuing mints a new secret, which the agent holding the old one can
 * never receive. Leaving them alone is the worst option of the three: the key
 * would keep authenticating while `listAgentKeys` — which filters Talos by
 * `actor_id="<agents.id>"` — could no longer see it, so its owner could
 * neither list nor revoke their own live credential.
 *
 * So they are revoked. Affected agents re-issue a key through the normal
 * `POST /agent-keys` flow; nothing else recovers them.
 *
 * Only MoltNet-issued agent keys are considered (`metadata.subject_type ===
 * 'agent'`). Keys belonging to anything else are never touched, and keys
 * already revoked or expired are skipped.
 *
 * Classification, from the post-migration tables:
 *
 *   actor_id ∈ agents.id          → current, issued after the cutover. Skip.
 *   actor_id ∈ agents.identity_id → legacy. Revoke, naming the agent it maps to.
 *   neither                       → orphan: an identity no agent row claims,
 *                                   which after the 2026-09-04 deletion
 *                                   incident means it can no longer resolve at
 *                                   all. Revoke, counted separately.
 *
 * Usage:
 *   DATABASE_URL=... ORY_PROJECT_URL=... ORY_PROJECT_API_KEY=... \
 *     node infra/ory/revoke-legacy-agent-keys.mjs [--apply] [--concurrency N]
 *       [--state <path>]
 *
 * Against self-hosted Talos (the e2e stack, for rehearsal), replace
 * ORY_PROJECT_URL with TALOS_ADMIN_URL:
 *
 *   DATABASE_URL=postgres://moltnet:moltnet_secret@localhost:5433/moltnet \
 *   TALOS_ADMIN_URL=http://localhost:4420 \
 *     node infra/ory/revoke-legacy-agent-keys.mjs [--apply]
 *
 * `--state` is a per-window checkpoint keyed on key_id, not a durable ledger.
 * Use a fresh path per maintenance window.
 *
 * CodeQL note: `js/clear-text-logging` flags every line here that prints
 * anything derived from the issued-keys response — including
 * `keys scanned: ${scanned}`, which is an integer counter (`scanned +=
 * page.length`). The rule taints the whole response because the endpoint is an
 * API-key listing; it is not reasoning about the values. Talos returns a secret
 * only from the one-shot issue call, never from list or get, so no credential
 * can reach these sinks. The logging is nonetheless narrowed as far as it can
 * usefully go: everything goes through `keyRef`, and `safeId` emits a value
 * only if it is a bare UUID or ULID. The residual alerts are false positives to
 * dismiss, not code to change — removing them entirely would mean printing
 * nothing an operator could act on.
 */
import { execFileSync } from 'node:child_process';

import {
  assertTargetMatchesDatabase,
  openCheckpoint,
  parseArgs,
  pooled,
  request,
} from './lib/maintenance.mjs';

const args = parseArgs();
const APPLY = args.apply;
const CONCURRENCY = args.concurrency;
const STATE_PATH = args.statePath('.talos-legacy-key-revocation-state.log');
const PAGE_SIZE = 200;
// PRIVILEGE_WITHDRAWN rather than the seemingly-apter AFFILIATION_CHANGED:
// Talos rejects a `description` with any other reason —
//   400 description is only allowed when reason is PRIVILEGE_WITHDRAWN
// — and recording why each key died is worth more than the nuance. It is also
// the admin-only reason the API documents for exactly this pairing.
const REVOCATION_REASON = 'REVOCATION_REASON_PRIVILEGE_WITHDRAWN';

const trim = (url) => url?.replace(/\/$/, '');
const project = trim(process.env.ORY_PROJECT_URL);
const base = trim(process.env.TALOS_ADMIN_URL) ?? project;
const apiKey = process.env.ORY_PROJECT_API_KEY;
if (!base) {
  console.error('ORY_PROJECT_URL (or TALOS_ADMIN_URL) is required');
  process.exit(1);
}
// Self-hosted Talos has no bearer auth; Ory Network requires it.
if (project && !apiKey) {
  console.error('ORY_PROJECT_API_KEY is required with ORY_PROJECT_URL');
  process.exit(1);
}
const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
const api = `${base}/v2alpha1/admin/issuedApiKeys`;

/**
 * Read the two id sets straight from the post-migration tables.
 *
 * Through `psql` rather than a driver, matching the other infra/ory scripts:
 * `pg` belongs to libs/database and does not resolve from the repo root.
 */
function loadPrincipals() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const query = (sql) =>
    execFileSync('psql', [url, '-At', '-F', ',', '-c', sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(','));

  return {
    agentIds: new Set(query('SELECT id FROM agents').map(([id]) => id)),
    byIdentityId: new Map(
      query('SELECT identity_id, id FROM agents WHERE identity_id IS NOT NULL'),
    ),
  };
}

/** Yields one page of issued keys at a time; never holds the whole corpus. */
async function* pageKeys() {
  let pageToken;
  for (;;) {
    const query = new URLSearchParams({ page_size: String(PAGE_SIZE) });
    if (pageToken) query.set('page_token', pageToken);

    const response = await request(`${api}?${query}`, { headers });
    if (!response.ok) {
      throw new Error(`list keys: ${response.status} ${await response.text()}`);
    }
    const body = await response.json();
    yield body.issued_api_keys ?? [];

    if (!body.next_page_token || body.next_page_token === pageToken) return;
    pageToken = body.next_page_token;
  }
}

/** True for keys MoltNet issued for an agent. Anything else is out of scope. */
function isMoltnetAgentKey(key) {
  const metadata = key.metadata;
  return (
    !!metadata &&
    !Array.isArray(metadata) &&
    typeof metadata === 'object' &&
    metadata.subject_type === 'agent'
  );
}

/**
 * A key whose actor is a MoltNet principal but whose metadata is not an agent
 * binding.
 *
 * `subject_type: 'agent'` has been written by every MoltNet issuance since the
 * first one (schema v1, `1609500b8`), so this should be empty. It is reported
 * rather than assumed away because the scope filter above is the only thing
 * standing between this script and someone else's keys.
 *
 * Such a key is NOT revoked, and that is not a fail-open: token validation
 * runs the same `readAgentKeyMetadataBinding` check and returns null when it
 * does not parse (token-validator.ts), so the key cannot authenticate as an
 * agent to begin with. Revoking a key we cannot prove is ours would be the
 * larger risk.
 */
function isUnlabelledMoltnetActor(key, agentIds, byIdentityId) {
  const actorId = key.actor_id;
  return (
    typeof actorId === 'string' &&
    (agentIds.has(actorId) || byIdentityId.has(actorId))
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Talos issues UUID key ids in the self-hosted build this was rehearsed
// against, but its own API docs show ULIDs
// (`01HQZX9VYQKJB8XQZQXQZQXQXQ`). Accept both, or production would redact
// every id and the report would be useless exactly where it matters.
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/**
 * The only shape in which a value off the Talos response may reach a log.
 *
 * Anything that is not a bare UUID or ULID is dropped rather than printed (both
 * forms appear in the wild — see the ULID note above). That is a
 * whitelist, not a redaction: no matter what Talos returns — today, or after a
 * response-shape change nobody noticed — this function can emit only an opaque
 * identifier, so no secret, name or free-text field can reach the operator's
 * terminal or CI log through it.
 */
function safeId(value) {
  if (typeof value !== 'string') return '<redacted>';
  return UUID.test(value) || ULID.test(value) ? value : '<redacted>';
}

/**
 * The ONLY fields of a Talos key this script may print.
 *
 * Talos never returns a key secret from list or get — only the one-shot issue
 * response carries it — but the rest of the record is still not ours to spill
 * into operator logs. `name` is free text an operator typed and may contain
 * anything, including a credential someone pasted into a key name, and
 * `metadata` is an arbitrary blob belonging — in the one bucket where it gets
 * reported — to a key we have specifically concluded might NOT be MoltNet's.
 *
 * `key_id` and `actor_id` are opaque identifiers and are what an operator
 * needs to look a key up. That is the whole budget, and `safeId` enforces it
 * structurally rather than by convention.
 */
function keyRef(key) {
  return `${safeId(key.key_id)} actor=${safeId(key.actor_id)}`;
}

/**
 * Field NAMES present in a foreign key's metadata, never the values.
 *
 * The question the unlabelled bucket has to answer is "is my scope filter
 * narrower than the corpus" — which the shape answers and the contents do not.
 */
function metadataShape(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return '<none>';
  }
  // Field NAMES on a key we may not own are still third-party input, so they
  // are whitelisted to a conservative identifier charset and capped. The
  // operator needs to know which fields exist, not to receive them verbatim.
  const fields = Object.keys(metadata)
    .filter((field) => /^[A-Za-z0-9_]{1,40}$/.test(field))
    .sort()
    .slice(0, 12);
  return fields.length > 0 ? fields.join(',') : '<empty>';
}

/** Only an active key can be revoked; revoked and expired ones are already inert. */
function isActive(key) {
  return key.status === 'KEY_STATUS_ACTIVE';
}

async function revokeKey(key, description) {
  const response = await request(`${api}/${key.key_id}:revoke`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: REVOCATION_REASON, description }),
  });
  if (!response.ok) {
    throw new Error(
      `revoke ${key.key_id}: ${response.status} ${await response.text()}`,
    );
  }
}

assertTargetMatchesDatabase({
  apply: APPLY,
  databaseUrl: process.env.DATABASE_URL,
  targetUrl: base,
  targetName: 'Talos',
});

const { agentIds, byIdentityId } = loadPrincipals();

// Stream the corpus, retaining ONLY the keys that need revoking.
const legacy = [];
const orphans = [];
const unlabelled = [];
let scanned = 0;
let moltnetKeys = 0;
let current = 0;
let inactive = 0;

for await (const page of pageKeys()) {
  scanned += page.length;
  for (const key of page) {
    if (!isMoltnetAgentKey(key)) {
      if (
        isActive(key) &&
        isUnlabelledMoltnetActor(key, agentIds, byIdentityId)
      ) {
        unlabelled.push(key);
      }
      continue;
    }
    moltnetKeys += 1;
    if (!isActive(key)) {
      inactive += 1;
      continue;
    }
    const actorId = key.actor_id;
    if (typeof actorId === 'string' && agentIds.has(actorId)) {
      current += 1;
      continue;
    }
    const mapped = byIdentityId.get(actorId);
    if (mapped) legacy.push({ key, agentId: mapped });
    else orphans.push({ key, agentId: null });
  }
}

const work = [...legacy, ...orphans];

console.log(`agents                   : ${agentIds.size}`);
console.log(`keys scanned             : ${scanned}`); // codeql[js/clear-text-logging]
console.log(`moltnet agent keys       : ${moltnetKeys}`);
console.log(`  already revoked/expired: ${inactive}`);
console.log(`  current (agents.id)    : ${current}`);
console.log(`  legacy (identity_id)   : ${legacy.length}`);
console.log(`  orphaned (no agent row): ${orphans.length}`);
console.log(`to revoke                : ${work.length}`);

// Expected to be zero. If it is not, the scope filter is narrower than the
// real corpus and the assumption behind this script needs re-checking before
// the window proceeds.
if (unlabelled.length > 0) {
  console.warn(
    `\nWARNING: ${unlabelled.length} active key(s) name a MoltNet principal as ` +
      'actor but carry no agent binding metadata. They are NOT revoked, and ' +
      'they cannot authenticate as an agent either (token validation applies ' +
      'the same metadata check). Investigate before proceeding:',
  );
  for (const key of unlabelled.slice(0, 10)) {
    console.warn(
      `  ${keyRef(key)} metadata_fields=${metadataShape(key.metadata)}`, // codeql[js/clear-text-logging]
    );
  }
}

if (!APPLY) {
  for (const item of work.slice(0, 5)) {
    console.log(
      `  would revoke ${keyRef(item.key)}` +
        (item.agentId ? ` -> agent ${item.agentId}` : ' -> no agent row'), // codeql[js/clear-text-logging]
    );
  }
  console.log('\nDRY RUN — pass --apply to revoke.');
  process.exit(0);
}

const checkpoint = openCheckpoint(STATE_PATH);
const remaining = work.filter((item) => !checkpoint.has(item.key.key_id));
if (checkpoint.size() > 0) {
  console.log(
    `\nresuming: ${checkpoint.size()} already revoked, ${remaining.length} remaining`,
  );
}

let completed = 0;
await pooled(remaining, CONCURRENCY, async (item) => {
  await revokeKey(
    item.key,
    item.agentId
      ? `MoltNet principal decoupling: actor_id was Kratos identity ${item.key.actor_id}; agent is now ${item.agentId}. Talos cannot rewrite actor_id, so this key is revoked and must be re-issued.`
      : `MoltNet principal decoupling: actor_id ${item.key.actor_id} resolves to no agent, so this key can no longer authenticate.`,
  );

  checkpoint.record(item.key.key_id);
  completed += 1;
  if (completed % 50 === 0 || completed === remaining.length) {
    console.log(`  ${completed}/${remaining.length}`);
  }
});

// Verify by re-reading, rather than trusting the writes we just made.
let stillActive = 0;
for await (const page of pageKeys()) {
  for (const key of page) {
    if (!isMoltnetAgentKey(key) || !isActive(key)) continue;
    if (typeof key.actor_id === 'string' && agentIds.has(key.actor_id))
      continue;
    stillActive += 1;
    console.error(`  STILL ACTIVE ${keyRef(key)}`); // codeql[js/clear-text-logging]
  }
}

console.log(`\nRevoked ${completed} keys.`);
console.log(`Active agent keys not bound to an agents.id: ${stillActive}`);
if (stillActive > 0) {
  console.error('FAIL: some legacy agent keys are still active');
  process.exit(1);
}
console.log('PASS — every active MoltNet agent key resolves to an agents.id');
