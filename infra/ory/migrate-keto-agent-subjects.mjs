#!/usr/bin/env node
/**
 * Rewrite Keto agent subjects from Kratos identity IDs to internal agent IDs.
 *
 * Runs immediately after migration 0041 inside the same maintenance window.
 * Until it completes, agents authenticate but resolve no permissions: Postgres
 * refers to `agents.id` while Keto still says `Agent:<identity_id>`.
 *
 * The mapping is read from the database rather than passed in — after 0041 the
 * `agents` table holds both sides of it, so there is no separate artifact to
 * keep in sync.
 *
 * Keto tuples are immutable, so each is re-created under the new subject and
 * the old one deleted. Creation happens FIRST, so an interruption leaves an
 * agent over-permitted (both subjects valid) rather than locked out.
 *
 * Usage:
 *   DATABASE_URL=... ORY_PROJECT_URL=... ORY_PROJECT_API_KEY=... \
 *     node infra/ory/migrate-keto-agent-subjects.mjs [--apply]
 */
import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');

const base = process.env.ORY_PROJECT_URL?.replace(/\/$/, '');
const apiKey = process.env.ORY_PROJECT_API_KEY;
if (!base || !apiKey) {
  console.error('ORY_PROJECT_URL and ORY_PROJECT_API_KEY are required');
  process.exit(1);
}
const headers = { Authorization: `Bearer ${apiKey}` };

/**
 * old Kratos identity id -> new internal agents.id
 *
 * Read through `psql` rather than a driver: the other infra/ory scripts depend
 * only on Node builtins, and `pg` belongs to libs/database so it does not
 * resolve from the repo root.
 */
function loadMapping() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const out = execFileSync(
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
  );

  return new Map(
    out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(',')),
  );
}

async function listAllTuples() {
  const tuples = [];
  let pageToken;

  while (true) {
    const query = new URLSearchParams({ page_size: '500' });
    if (pageToken) query.set('page_token', pageToken);

    const response = await fetch(`${base}/relation-tuples?${query}`, { headers });
    if (!response.ok) {
      throw new Error(`list tuples: ${response.status} ${await response.text()}`);
    }
    const body = await response.json();
    tuples.push(...(body.relation_tuples ?? []));

    if (!body.next_page_token || body.next_page_token === pageToken) break;
    pageToken = body.next_page_token;
  }

  return tuples;
}

/** Returns the rewritten tuple, or null when nothing in it refers to an agent. */
function rewrite(tuple, mapping) {
  let changed = false;
  const next = {
    namespace: tuple.namespace,
    object: tuple.object,
    relation: tuple.relation,
  };

  if (tuple.namespace === 'Agent' && mapping.has(tuple.object)) {
    next.object = mapping.get(tuple.object);
    changed = true;
  }

  if (tuple.subject_set) {
    const object =
      tuple.subject_set.namespace === 'Agent' &&
      mapping.has(tuple.subject_set.object)
        ? mapping.get(tuple.subject_set.object)
        : tuple.subject_set.object;
    if (object !== tuple.subject_set.object) changed = true;
    next.subject_set = { ...tuple.subject_set, object };
  } else if (tuple.subject_id) {
    next.subject_id = tuple.subject_id;
  }

  return changed ? next : null;
}

/**
 * Refuse to write production Keto from a local database.
 *
 * A rehearsal runs this against a restored copy on 127.0.0.1 while
 * ORY_PROJECT_URL still points at production. Dry-running that way is
 * harmless, but `--apply` would rewrite production tuples to agent IDs that
 * exist only in the throwaway container — every agent authorized against
 * nothing. The combination is never legitimate, so reject it outright.
 */
function assertDatabaseAndOryAgree() {
  const dbHost = new URL(process.env.DATABASE_URL).hostname;
  const oryHost = new URL(base).hostname;
  const dbIsLocal = ['localhost', '127.0.0.1', '::1'].includes(dbHost);
  const oryIsLocal =
    ['localhost', '127.0.0.1', '::1'].includes(oryHost) ||
    oryHost.endsWith('.local');

  if (APPLY && dbIsLocal && !oryIsLocal) {
    console.error(
      `Refusing to apply: DATABASE_URL points at ${dbHost} (local) while ` +
        `ORY_PROJECT_URL points at ${oryHost} (remote). The agent IDs read ` +
        'from a local copy do not exist in that Ory project, so applying ' +
        'would leave every agent authorized against nothing.',
    );
    process.exit(1);
  }
}

assertDatabaseAndOryAgree();

const mapping = loadMapping();
const tuples = await listAllTuples();
const work = [];
for (const tuple of tuples) {
  const next = rewrite(tuple, mapping);
  if (next) work.push({ from: tuple, to: next });
}

console.log(`agents with an identity : ${mapping.size}`);
console.log(`total tuples            : ${tuples.length}`);
console.log(`tuples to rewrite       : ${work.length}`);

if (!APPLY) {
  for (const item of work.slice(0, 3)) {
    console.log(`  ${JSON.stringify(item.from)}\n    -> ${JSON.stringify(item.to)}`);
  }
  console.log('\nDRY RUN — pass --apply to write.');
  process.exit(0);
}

let done = 0;
for (const [index, item] of work.entries()) {
  const put = await fetch(`${base}/admin/relation-tuples`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(item.to),
  });
  if (!put.ok) {
    throw new Error(`create ${JSON.stringify(item.to)}: ${put.status} ${await put.text()}`);
  }

  const query = new URLSearchParams({
    namespace: item.from.namespace,
    object: item.from.object,
    relation: item.from.relation,
  });
  if (item.from.subject_set) {
    query.set('subject_set.namespace', item.from.subject_set.namespace);
    query.set('subject_set.object', item.from.subject_set.object);
    query.set('subject_set.relation', item.from.subject_set.relation ?? '');
  } else if (item.from.subject_id) {
    query.set('subject_id', item.from.subject_id);
  }

  const del = await fetch(`${base}/admin/relation-tuples?${query}`, {
    method: 'DELETE',
    headers,
  });
  if (!del.ok) {
    throw new Error(`delete ${JSON.stringify(item.from)}: ${del.status} ${await del.text()}`);
  }

  done += 1;
  if (done % 50 === 0 || index === work.length - 1) {
    console.log(`  ${done}/${work.length}`);
  }
}

// Verify: no tuple may still name a Kratos identity as an agent subject.
const after = await listAllTuples();
const stale = after.filter(
  (t) =>
    (t.namespace === 'Agent' && mapping.has(t.object)) ||
    (t.subject_set?.namespace === 'Agent' && mapping.has(t.subject_set.object)),
);

console.log(`\nRewrote ${done} tuples.`);
console.log(`Residual tuples on old identity subjects: ${stale.length}`);
if (stale.length > 0) {
  console.error('FAIL: some agent subjects still reference a Kratos identity');
  process.exit(1);
}
console.log('PASS — every agent subject now uses agents.id');
