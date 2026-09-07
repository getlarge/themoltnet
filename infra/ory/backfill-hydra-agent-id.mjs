#!/usr/bin/env node
/**
 * Write an explicit `agent_id` into MoltNet OAuth2 client metadata.
 *
 * Runs inside the maintenance window, AFTER the migration and before the
 * deploy. Two things depend on it:
 *
 *  - the token webhook resolves the agent from `metadata.agent_id`, so until
 *    this runs it falls back to an identity lookup;
 *  - credential recovery derives the deterministic OAuth2 client ID from
 *    `agents.id`. A client created before the decoupling was derived from the
 *    Kratos identity, so after a relink the legacy client cannot be found and
 *    the agent cannot recover its credentials. This backfill records the link
 *    that makes the legacy client findable.
 *
 * The value comes from the DATABASE, not from `metadata.identity_id`. Before
 * the migration those two coincided; afterwards `agents.id` is a fresh UUID,
 * so deriving `agent_id` from the stored identity would write the wrong value
 * into every client.
 *
 * Only `client_credentials` clients carrying MoltNet metadata are touched.
 * Human `authorization_code` clients created by DCR are never modified.
 *
 * Idempotent: a client already carrying the correct `agent_id` is skipped, and
 * one carrying a WRONG value is reported and left alone unless `--repair` is
 * passed — silently overwriting it would hide a real inconsistency.
 *
 * Usage:
 *   DATABASE_URL=... ORY_PROJECT_URL=... ORY_PROJECT_API_KEY=... \
 *     node infra/ory/backfill-hydra-agent-id.mjs [--apply] [--repair]
 */
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const REPAIR = argv.includes('--repair');

const base = process.env.ORY_PROJECT_URL?.replace(/\/$/, '');
const apiKey = process.env.ORY_PROJECT_API_KEY;
if (!base || !apiKey) {
  console.error('ORY_PROJECT_URL and ORY_PROJECT_API_KEY are required');
  process.exit(1);
}
const headers = { Authorization: `Bearer ${apiKey}` };

// Maintenance-critical requests run on the critical path of an outage: one
// stalled socket would otherwise extend the window indefinitely.
const REQUEST_TIMEOUT_MS = Number(process.env.ORY_REQUEST_TIMEOUT_MS ?? 30_000);
const requestTimeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

function query(sql) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  return execFileSync('psql', [url, '-At', '-F', ',', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(','));
}

/**
 * Two ways to resolve a client to its agent, in order of confidence.
 *
 * `byIdentity` is the obvious one, but it fails for exactly the cohort this
 * whole change exists to serve: an agent relinked after the 2026-09-04 deletion
 * carries a NEW `agents.identity_id`, while its OAuth2 client's metadata still
 * names the DEAD identity. Those clients join to nothing.
 *
 * `byPublicKey` recovers them. The public key is the agent's durable
 * cryptographic identity — it is what registration proved possession of and
 * what `agents.public_key` is keyed on — so it survives any number of identity
 * recreations. Without it the incident cohort would keep an unresolvable
 * client and could never recover credentials.
 */
function loadMapping() {
  return {
    byIdentity: new Map(
      query('SELECT identity_id, id FROM agents WHERE identity_id IS NOT NULL'),
    ),
    byPublicKey: new Map(query('SELECT public_key, id FROM agents')),
  };
}

/** Every agents.id, so a backfilled value can be proven to resolve. */
function loadAgentIds() {
  const url = process.env.DATABASE_URL;
  return new Set(
    execFileSync('psql', [url, '-At', '-c', 'SELECT id FROM agents'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .split('\n')
      .filter(Boolean),
  );
}

/**
 * Resolve a `Link: rel="next"` target, refusing anything off the configured
 * origin.
 *
 * Every page request carries the production Ory admin bearer. Following an
 * absolute URL out of a response header without checking it would send that
 * credential wherever the header said — a response-header injection, a
 * misconfigured proxy or a compromised upstream would be enough. Resolving
 * against `base` and comparing origins keeps the token on the host we were
 * configured to talk to.
 */
function nextPageUrl(linkHeader, currentUrl) {
  const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  if (!match) return null;

  let candidate;
  try {
    candidate = new URL(match[1], currentUrl);
  } catch {
    throw new Error(`unparseable Link header target: ${match[1]}`);
  }
  if (candidate.origin !== new URL(base).origin) {
    throw new Error(
      `refusing to follow pagination to a different origin: ${candidate.origin}`,
    );
  }
  return candidate.toString();
}

async function listAllClients() {
  const clients = [];
  let url = `${base}/admin/clients?page_size=500`;
  const seen = new Set();
  while (url) {
    // A server that keeps pointing at a page it already served would otherwise
    // spin here for the length of the maintenance window.
    if (seen.has(url)) break;
    seen.add(url);

    const response = await fetch(url, { headers, signal: requestTimeout() });
    if (!response.ok) {
      throw new Error(
        `list clients: ${response.status} ${await response.text()}`,
      );
    }
    clients.push(...(await response.json()));
    url = nextPageUrl(response.headers.get('link') ?? '', url);
  }
  return clients;
}

const mapping = loadMapping();
const agentIds = loadAgentIds();
const clients = await listAllClients();

// A MoltNet agent client is identified by carrying either handle we can resolve
// on. Requiring identity_id alone would exclude the relinked cohort before we
// ever get to look at their public key.
const moltnetClients = clients.filter(
  (client) =>
    Array.isArray(client.grant_types) &&
    client.grant_types.includes('client_credentials') &&
    (typeof client.metadata?.identity_id === 'string' ||
      typeof client.metadata?.public_key === 'string'),
);

const targets = [];
const alreadyCorrect = [];
const mismatched = [];
const unmappable = [];
let viaPublicKey = 0;

for (const client of moltnetClients) {
  // Identity first when it still resolves; public key for the relinked cohort,
  // whose stored identity_id is dead. Never guess beyond these two.
  let expected = mapping.byIdentity.get(client.metadata.identity_id);
  if (!expected) {
    expected = mapping.byPublicKey.get(client.metadata.public_key);
    if (expected) viaPublicKey += 1;
  }
  if (!expected) {
    // Neither handle resolves: a client for a deleted agent, or one MoltNet
    // never created.
    unmappable.push(client);
    continue;
  }
  const current = client.metadata.agent_id;
  if (typeof current === 'string' && current !== '') {
    if (current === expected) alreadyCorrect.push(client);
    else mismatched.push({ client, current, expected });
    continue;
  }
  targets.push({ client, agentId: expected });
}

console.log(`total clients            : ${clients.length}`);
console.log(`moltnet agent clients    : ${moltnetClients.length}`);
console.log(`already correct          : ${alreadyCorrect.length}`);
console.log(`to backfill              : ${targets.length}`);
console.log(`mismatched agent_id      : ${mismatched.length}`);
console.log(`resolved via public_key  : ${viaPublicKey}`);
console.log(`unresolvable             : ${unmappable.length}`);

for (const item of mismatched) {
  console.warn(
    `  MISMATCH ${item.client.client_id}: has ${item.current}, expected ${item.expected}`,
  );
}
for (const client of unmappable) {
  console.warn(
    `  UNRESOLVABLE ${client.client_id}: neither identity ${client.metadata?.identity_id ?? '<none>'} nor its public key matches an agent row`,
  );
}

// Every value about to be written must resolve to a real agent. This is the
// verification gate the deploy checklist requires before the webhook starts
// trusting agent_id.
const unresolvable = targets.filter((item) => !agentIds.has(item.agentId));
if (unresolvable.length > 0) {
  console.error(
    `\nFAIL: ${unresolvable.length} value(s) do not resolve to an agents.id; refusing to write.`,
  );
  process.exit(1);
}

if (!APPLY) {
  for (const item of targets.slice(0, 5)) {
    console.log(
      `  would set ${item.client.client_id}: agent_id=${item.agentId}`,
    );
  }
  console.log('\nDRY RUN — pass --apply to write.');
  process.exit(0);
}

async function patchAgentId(clientId, agentId, replace) {
  // Client ids are opaque strings, so a reserved character would otherwise
  // re-target this privileged request.
  const response = await fetch(
    `${base}/admin/clients/${encodeURIComponent(clientId)}`,
    {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          op: replace ? 'replace' : 'add',
          path: '/metadata/agent_id',
          value: agentId,
        },
      ]),
      signal: requestTimeout(),
    },
  );
  if (!response.ok) {
    throw new Error(`${clientId}: ${response.status} ${await response.text()}`);
  }
}

let done = 0;
for (const item of targets) {
  await patchAgentId(item.client.client_id, item.agentId, false);
  done += 1;
  console.log(
    `  [${done}/${targets.length}] ${item.client.client_id} -> agent_id=${item.agentId}`,
  );
}

let repaired = 0;
if (REPAIR) {
  for (const item of mismatched) {
    await patchAgentId(item.client.client_id, item.expected, true);
    repaired += 1;
    console.log(`  REPAIRED ${item.client.client_id} -> ${item.expected}`);
  }
}

// Verify by re-reading, rather than trusting the writes we just made.
const after = await listAllClients();
const stillWrong = after.filter((client) => {
  if (
    !Array.isArray(client.grant_types) ||
    !client.grant_types.includes('client_credentials')
  ) {
    return false;
  }
  const expected =
    mapping.byIdentity.get(client.metadata?.identity_id) ??
    mapping.byPublicKey.get(client.metadata?.public_key);
  return expected !== undefined && client.metadata?.agent_id !== expected;
});

console.log(
  `\nBackfilled ${done} clients${REPAIR ? `, repaired ${repaired}` : ''}.`,
);
console.log(
  `Clients still missing or holding a wrong agent_id: ${stillWrong.length}`,
);
if (stillWrong.length > 0) {
  for (const client of stillWrong) {
    console.error(
      `  ${client.client_id}: agent_id=${client.metadata.agent_id ?? '<absent>'}`,
    );
  }
  console.error(
    REPAIR
      ? 'FAIL: some clients could not be reconciled'
      : 'FAIL: re-run with --repair to overwrite mismatched values',
  );
  process.exit(1);
}
console.log('PASS — every MoltNet agent client resolves to its agents.id');
