#!/usr/bin/env node
/**
 * Rewrite Keto subjects from Ory Kratos identity IDs to internal MoltNet IDs.
 *
 * Covers BOTH namespaces:
 *   Agent:<identity_id> -> Agent:<agents.id>
 *   Human:<identity_id> -> Human:<humans.id>
 *
 * Runs inside the maintenance window, immediately after the migration. Until
 * it completes, principals authenticate but resolve no permissions: Postgres
 * refers to the internal ids while Keto still says the Kratos identity. The
 * Human half is not optional — `plugin.ts` passes `humans.id` as the subject
 * for every human permission check, so skipping it leaves existing humans
 * authenticated and 403 on everything team-scoped.
 *
 * The mapping is read from the database rather than passed in: after the
 * migration both tables hold each side of it, so there is no separate artifact
 * to keep in sync.
 *
 * Keto tuples are immutable, so each is re-created under the new subject and
 * the old one deleted. Creation happens FIRST, so an interruption leaves a
 * principal over-permitted (both subjects valid) rather than locked out.
 *
 * Operationally this sits on the critical path of an authorization outage, so
 * it: pages the corpus instead of loading it, retains only the tuples that
 * actually need rewriting, applies them with bounded concurrency, and
 * checkpoints progress so an interrupted run resumes instead of restarting.
 *
 * Usage:
 *   DATABASE_URL=... ORY_PROJECT_URL=... ORY_PROJECT_API_KEY=... \
 *     node infra/ory/migrate-keto-subjects.mjs [--apply] [--concurrency N]
 *       [--state <path>] [--namespace Agent|Human]
 *
 * Against self-hosted Keto (the e2e stack, for rehearsal), replace
 * ORY_PROJECT_URL with ORY_KETO_READ_URL + ORY_KETO_ADMIN_URL:
 *
 *   DATABASE_URL=postgres://moltnet:moltnet_secret@localhost:5433/moltnet \
 *   ORY_KETO_READ_URL=http://localhost:4466 \
 *   ORY_KETO_ADMIN_URL=http://localhost:4467 \
 *     node infra/ory/migrate-keto-subjects.mjs [--apply]
 *
 * The e2e stack's own tuples are already keyed on internal ids, so a bare
 * rehearsal only exercises the no-op path. To rehearse the REWRITE path,
 * first seed tuples whose object/subject_set.object are `identity_id`s read
 * from the local agents/humans tables, then run the script and confirm the
 * verification pass reports zero residual.
 *
 * `--state` is a per-window checkpoint, not a durable ledger: it is keyed on
 * the SOURCE tuple, so pointing a second run at a previous window's state
 * file silently skips work. Use a fresh path per maintenance window.
 */
import {
  assertTargetMatchesDatabase,
  openCheckpoint,
  parseArgs,
  psqlRows,
  pooled,
  request,
} from './lib/maintenance.mjs';

const args = parseArgs();
const APPLY = args.apply;
const flag = args.flag;
const CONCURRENCY = args.concurrency;
const STATE_PATH = args.statePath('.keto-subject-migration-state.log');
const ONLY_NAMESPACE = flag('--namespace', null);
const PAGE_SIZE = 500;

/**
 * Ory Network serves the read and write APIs from one host, so
 * `ORY_PROJECT_URL` covers both. Self-hosted Keto splits them across two
 * ports (read 4466, write 4467), which is why this script could not be
 * rehearsed against the e2e stack until these overrides existed. Production
 * still needs only ORY_PROJECT_URL.
 */
const trim = (url) => url?.replace(/\/$/, '');
const project = trim(process.env.ORY_PROJECT_URL);
const readBase = trim(process.env.ORY_KETO_READ_URL) ?? project;
const writeBase = trim(process.env.ORY_KETO_ADMIN_URL) ?? project;
const apiKey = process.env.ORY_PROJECT_API_KEY;
if (!readBase || !writeBase) {
  console.error(
    'ORY_PROJECT_URL (or ORY_KETO_READ_URL + ORY_KETO_ADMIN_URL) is required',
  );
  process.exit(1);
}
// Self-hosted Keto has no bearer auth; Ory Network requires it.
if (project && !apiKey) {
  console.error('ORY_PROJECT_API_KEY is required with ORY_PROJECT_URL');
  process.exit(1);
}
const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

const NAMESPACES = ONLY_NAMESPACE ? [ONLY_NAMESPACE] : ['Agent', 'Human'];
for (const ns of NAMESPACES) {
  if (ns !== 'Agent' && ns !== 'Human') {
    console.error(`--namespace must be Agent or Human, got ${ns}`);
    process.exit(1);
  }
}

/**
 * old Kratos identity id -> new internal id, per namespace.
 *
 * Read through `psql` rather than a driver: the other infra/ory scripts depend
 * only on Node builtins, and `pg` belongs to libs/database so it does not
 * resolve from the repo root.
 */
function loadMapping() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const query = (sql) => new Map(psqlRows(sql, url));

  return {
    Agent: query(
      'SELECT identity_id, id FROM agents WHERE identity_id IS NOT NULL',
    ),
    Human: query(
      'SELECT identity_id, id FROM humans WHERE identity_id IS NOT NULL',
    ),
  };
}

/** Yields one page of tuples at a time; never holds the whole corpus. */
async function* pageTuples() {
  let pageToken;
  for (;;) {
    const query = new URLSearchParams({ page_size: String(PAGE_SIZE) });
    if (pageToken) query.set('page_token', pageToken);

    const response = await request(`${readBase}/relation-tuples?${query}`, {
      headers,
    });
    if (!response.ok) {
      throw new Error(
        `list tuples: ${response.status} ${await response.text()}`,
      );
    }
    const body = await response.json();
    yield body.relation_tuples ?? [];

    if (!body.next_page_token || body.next_page_token === pageToken) return;
    pageToken = body.next_page_token;
  }
}

/** Returns the rewritten tuple, or null when nothing in it names a mapped subject. */
function rewrite(tuple, mapping) {
  let changed = false;
  const next = {
    namespace: tuple.namespace,
    object: tuple.object,
    relation: tuple.relation,
  };

  const mapped = mapping[tuple.namespace];
  if (mapped?.has(tuple.object)) {
    next.object = mapped.get(tuple.object);
    changed = true;
  }

  if (tuple.subject_set) {
    const setMap = mapping[tuple.subject_set.namespace];
    const object = setMap?.has(tuple.subject_set.object)
      ? setMap.get(tuple.subject_set.object)
      : tuple.subject_set.object;
    if (object !== tuple.subject_set.object) changed = true;
    next.subject_set = { ...tuple.subject_set, object };
  } else if (tuple.subject_id) {
    next.subject_id = tuple.subject_id;
  }

  return changed ? next : null;
}

/** Stable key for checkpointing, so a resumed run skips completed work. */
function tupleKey(tuple) {
  const subject = tuple.subject_set
    ? `set:${tuple.subject_set.namespace}:${tuple.subject_set.object}:${tuple.subject_set.relation ?? ''}`
    : `id:${tuple.subject_id ?? ''}`;
  return `${tuple.namespace}|${tuple.object}|${tuple.relation}|${subject}`;
}

async function createTuple(tuple) {
  const response = await request(`${writeBase}/admin/relation-tuples`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(tuple),
  });
  if (!response.ok) {
    throw new Error(
      `create ${JSON.stringify(tuple)}: ${response.status} ${await response.text()}`,
    );
  }
}

async function deleteTuple(tuple) {
  const query = new URLSearchParams({
    namespace: tuple.namespace,
    object: tuple.object,
    relation: tuple.relation,
  });
  if (tuple.subject_set) {
    query.set('subject_set.namespace', tuple.subject_set.namespace);
    query.set('subject_set.object', tuple.subject_set.object);
    query.set('subject_set.relation', tuple.subject_set.relation ?? '');
  } else if (tuple.subject_id) {
    query.set('subject_id', tuple.subject_id);
  }

  const response = await request(
    `${writeBase}/admin/relation-tuples?${query}`,
    { method: 'DELETE', headers },
  );
  if (!response.ok) {
    throw new Error(
      `delete ${JSON.stringify(tuple)}: ${response.status} ${await response.text()}`,
    );
  }
}

assertTargetMatchesDatabase({
  apply: APPLY,
  databaseUrl: process.env.DATABASE_URL,
  targetUrl: writeBase,
  targetName: 'the Keto write API',
  allowProxiedDatabase: args.allowProxiedDatabase,
});

const mapping = loadMapping();
for (const ns of Object.keys(mapping)) {
  if (!NAMESPACES.includes(ns)) mapping[ns] = new Map();
}

// Stream the corpus, retaining ONLY the tuples that need rewriting. The full
// corpus is never held, and mutation never happens mid-pagination.
const work = [];
let scanned = 0;
for await (const page of pageTuples()) {
  scanned += page.length;
  for (const tuple of page) {
    const next = rewrite(tuple, mapping);
    if (next) work.push({ from: tuple, to: next });
  }
}

console.log(`agents mapped          : ${mapping.Agent.size}`);
console.log(`humans mapped          : ${mapping.Human.size}`);
console.log(`tuples scanned         : ${scanned}`);
console.log(`tuples to rewrite      : ${work.length}`);
for (const ns of NAMESPACES) {
  const count = work.filter(
    (item) =>
      item.from.namespace === ns || item.from.subject_set?.namespace === ns,
  ).length;
  console.log(`  ${ns.padEnd(6)}               : ${count}`);
}

if (!APPLY) {
  for (const item of work.slice(0, 3)) {
    console.log(
      `  ${JSON.stringify(item.from)}\n    -> ${JSON.stringify(item.to)}`,
    );
  }
  console.log('\nDRY RUN — pass --apply to write.');
  process.exit(0);
}

const checkpoint = openCheckpoint(STATE_PATH);
const remaining = work.filter((item) => !checkpoint.has(tupleKey(item.from)));
if (checkpoint.size() > 0) {
  console.log(
    `\nresuming: ${checkpoint.size()} already applied, ${remaining.length} remaining`,
  );
}

let completed = 0;
await pooled(remaining, CONCURRENCY, async (item) => {
  // Create before delete: an interruption over-permits rather than locks out.
  await createTuple(item.to);
  await deleteTuple(item.from);

  // Recorded immediately, not batched: a batched checkpoint loses up to a
  // batch of work on interrupt, and the append costs one write.
  checkpoint.record(tupleKey(item.from));
  completed += 1;
  if (completed % 50 === 0 || completed === remaining.length) {
    console.log(`  ${completed}/${remaining.length}`);
  }
});

// Verify: no tuple may still name a Kratos identity as a mapped subject.
let stale = 0;
for await (const page of pageTuples()) {
  for (const tuple of page) {
    if (rewrite(tuple, mapping)) stale += 1;
  }
}

console.log(`\nRewrote ${completed} tuples.`);
console.log(`Residual tuples on old identity subjects: ${stale}`);
if (stale > 0) {
  console.error('FAIL: some subjects still reference a Kratos identity');
  process.exit(1);
}
console.log('PASS — every Agent and Human subject now uses its internal id');
