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
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');

function flag(name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

const CONCURRENCY = Math.max(1, Number(flag('--concurrency', '8')));
const STATE_PATH = flag('--state', '.keto-subject-migration-state.json');
const ONLY_NAMESPACE = flag('--namespace', null);
const PAGE_SIZE = 500;

const base = process.env.ORY_PROJECT_URL?.replace(/\/$/, '');
const apiKey = process.env.ORY_PROJECT_API_KEY;
if (!base || !apiKey) {
  console.error('ORY_PROJECT_URL and ORY_PROJECT_API_KEY are required');
  process.exit(1);
}
const headers = { Authorization: `Bearer ${apiKey}` };

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

  const query = (sql) =>
    new Map(
      execFileSync('psql', [url, '-At', '-F', ',', '-c', sql], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(',')),
    );

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

    const response = await fetch(`${base}/relation-tuples?${query}`, {
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

function loadState() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    return new Set(parsed.done ?? []);
  } catch {
    return new Set();
  }
}

/** Atomic so an interrupt cannot leave a truncated checkpoint. */
function saveState(done) {
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify({ done: [...done] }, null, 2));
  renameSync(tmp, STATE_PATH);
}

async function createTuple(tuple) {
  const response = await fetch(`${base}/admin/relation-tuples`, {
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

  const response = await fetch(`${base}/admin/relation-tuples?${query}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok) {
    throw new Error(
      `delete ${JSON.stringify(tuple)}: ${response.status} ${await response.text()}`,
    );
  }
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function pooled(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
}

/**
 * Refuse to write production Keto from a local database.
 *
 * A rehearsal runs this against a restored copy on 127.0.0.1 while
 * ORY_PROJECT_URL still points at production. Dry-running that way is
 * harmless, but `--apply` would rewrite production tuples to internal IDs that
 * exist only in the throwaway container — every principal authorized against
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
        `ORY_PROJECT_URL points at ${oryHost} (remote). The internal IDs read ` +
        'from a local copy do not exist in that Ory project, so applying ' +
        'would leave every principal authorized against nothing.',
    );
    process.exit(1);
  }
}

assertDatabaseAndOryAgree();

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

const done = loadState();
const remaining = work.filter((item) => !done.has(tupleKey(item.from)));
if (done.size > 0) {
  console.log(
    `\nresuming: ${done.size} already applied, ${remaining.length} remaining`,
  );
}

let completed = 0;
let checkpointAt = 0;
await pooled(remaining, CONCURRENCY, async (item) => {
  // Create before delete: an interruption over-permits rather than locks out.
  await createTuple(item.to);
  await deleteTuple(item.from);

  done.add(tupleKey(item.from));
  completed += 1;
  if (completed - checkpointAt >= 50 || completed === remaining.length) {
    checkpointAt = completed;
    saveState(done);
    console.log(`  ${completed}/${remaining.length}`);
  }
});
saveState(done);

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
