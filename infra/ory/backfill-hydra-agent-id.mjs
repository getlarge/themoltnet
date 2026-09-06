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

/** Kratos identity id -> agents.id, straight from the post-migration table. */
function loadMapping() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  return new Map(
    execFileSync(
      'psql',
      [
        url,
        '-At',
        '-F',
        ',',
        '-c',
        'SELECT identity_id, id FROM agents WHERE identity_id IS NOT NULL',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(',')),
  );
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

async function listAllClients() {
  const clients = [];
  let url = `${base}/admin/clients?page_size=500`;
  while (url) {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(
        `list clients: ${response.status} ${await response.text()}`,
      );
    }
    clients.push(...(await response.json()));
    const link = response.headers.get('link') ?? '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? (next[1].startsWith('http') ? next[1] : base + next[1]) : null;
  }
  return clients;
}

const mapping = loadMapping();
const agentIds = loadAgentIds();
const clients = await listAllClients();

const moltnetClients = clients.filter(
  (client) =>
    Array.isArray(client.grant_types) &&
    client.grant_types.includes('client_credentials') &&
    typeof client.metadata?.identity_id === 'string',
);

const targets = [];
const alreadyCorrect = [];
const mismatched = [];
const unmappable = [];

for (const client of moltnetClients) {
  const expected = mapping.get(client.metadata.identity_id);
  if (!expected) {
    // The client names an identity no agent row claims. Never guess: this is
    // a client for a deleted agent, or an identity that was never relinked.
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
console.log(`identity not in agents   : ${unmappable.length}`);

for (const item of mismatched) {
  console.warn(
    `  MISMATCH ${item.client.client_id}: has ${item.current}, expected ${item.expected}`,
  );
}
for (const client of unmappable) {
  console.warn(
    `  UNMAPPABLE ${client.client_id}: identity ${client.metadata.identity_id} has no agent row`,
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
  const response = await fetch(`${base}/admin/clients/${clientId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      {
        op: replace ? 'replace' : 'add',
        path: '/metadata/agent_id',
        value: agentId,
      },
    ]),
  });
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
const stillWrong = after.filter(
  (client) =>
    Array.isArray(client.grant_types) &&
    client.grant_types.includes('client_credentials') &&
    typeof client.metadata?.identity_id === 'string' &&
    mapping.has(client.metadata.identity_id) &&
    client.metadata.agent_id !== mapping.get(client.metadata.identity_id),
);

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
