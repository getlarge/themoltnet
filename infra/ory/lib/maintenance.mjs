/**
 * Shared primitives for the one-shot Ory maintenance scripts.
 *
 * `migrate-keto-subjects.mjs`, `backfill-hydra-agent-id.mjs` and
 * `revoke-legacy-agent-keys.mjs` are three steps of ONE maintenance procedure,
 * run back to back inside a single window. They had independently grown their
 * own flag parsing, safety guard, worker pool and checkpoint, which is how a
 * fix to one — the refusal to write a remote Ory from a local database, say —
 * silently fails to reach the other two.
 *
 * Everything here runs on the critical path of an authorization outage, so the
 * bias throughout is: bounded work, no unbounded waits, and progress that
 * survives an interrupt.
 *
 * Dependency-free by design. These run as `node infra/ory/<script>.mjs` from
 * the repo root, where nothing from the workspace resolves.
 */
import { appendFileSync, closeSync, openSync, readFileSync } from 'node:fs';

// ── Arguments ────────────────────────────────────────────────────────────────

export function parseArgs(argv = process.argv.slice(2)) {
  const flag = (name, fallback) => {
    const index = argv.indexOf(name);
    return index === -1 ? fallback : argv[index + 1];
  };
  return {
    argv,
    apply: argv.includes('--apply'),
    repair: argv.includes('--repair'),
    flag,
    concurrency: Math.max(1, Number(flag('--concurrency', '8'))),
    statePath: (fallback) => flag('--state', fallback),
  };
}

// ── Safety ───────────────────────────────────────────────────────────────────

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

const isLocal = (host) => LOCAL_HOSTS.includes(host) || host.endsWith('.local');

/**
 * Refuse to mutate a REMOTE Ory using ids read from a LOCAL database.
 *
 * A rehearsal restores production into a throwaway container on 127.0.0.1
 * while the Ory URL still points at production. Dry-running that way is
 * harmless and useful; applying it would write ids that exist only in the
 * container, leaving every principal authorized against nothing. The
 * combination is never legitimate, so it is rejected rather than warned about.
 *
 * The reverse (remote database, local Ory) is a rehearsal reading production
 * read-only, so it is allowed.
 */
export function assertTargetMatchesDatabase({
  apply,
  databaseUrl,
  targetUrl,
  targetName,
}) {
  if (!apply) return;
  const dbHost = new URL(databaseUrl).hostname;
  const targetHost = new URL(targetUrl).hostname;
  if (isLocal(dbHost) && !isLocal(targetHost)) {
    console.error(
      `Refusing to apply: DATABASE_URL points at ${dbHost} (local) while ` +
        `${targetName} points at ${targetHost} (remote). The ids read from a ` +
        'local copy do not describe that deployment, so applying would act on ' +
        'live state using unrelated data.',
    );
    process.exit(1);
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = Number(process.env.ORY_REQUEST_TIMEOUT_MS ?? 30_000);
const DEFAULT_RETRIES = Number(process.env.ORY_REQUEST_RETRIES ?? 4);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Honour `Retry-After` when the server sends one; otherwise back off with jitter. */
function backoffMs(response, attempt) {
  const header = response?.headers?.get?.('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30_000);
    }
    const at = Date.parse(header);
    if (!Number.isNaN(at))
      return Math.min(Math.max(at - Date.now(), 0), 30_000);
  }
  const base = Math.min(500 * 2 ** attempt, 8_000);
  // Jitter so a pool of workers does not retry in lockstep after a 429.
  return base / 2 + Math.random() * (base / 2);
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * `fetch` with a deadline and bounded retries.
 *
 * Every call carries a deadline: without one a single stalled socket extends
 * the outage for as long as the TCP stack allows. Retries cover 429 and 5xx,
 * which are the responses a rate-limited or briefly-unavailable Ory returns
 * mid-run — aborting there would leave the corpus half-mutated, which is worse
 * than waiting.
 *
 * Callers must only use this for IDEMPOTENT requests. Every mutation in these
 * scripts is one (PUT a tuple, DELETE a tuple, PATCH metadata to a fixed
 * value), so a retry that duplicates a request whose response was lost is
 * harmless.
 */
export async function request(url, init = {}, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Timeouts and connection failures are retryable; the request either
      // never landed or its response was lost, and the call is idempotent.
      lastError = error;
      if (attempt === retries) throw error;
      await sleep(backoffMs(null, attempt));
      continue;
    }

    if (!RETRYABLE.has(response.status) || attempt === retries) return response;

    const wait = backoffMs(response, attempt);
    console.warn(
      `  retrying ${response.status} in ${Math.round(wait)}ms (attempt ${attempt + 1}/${retries})`,
    );
    await sleep(wait);
  }
  throw lastError ?? new Error('request failed');
}

// ── Concurrency ──────────────────────────────────────────────────────────────

/** Runs `worker` over `items` with at most `limit` in flight. */
export async function pooled(items, limit, worker) {
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

// ── Checkpointing ────────────────────────────────────────────────────────────

/**
 * Append-only progress log, so an interrupted run resumes.
 *
 * Deliberately not a JSON snapshot of the completed set: rewriting that set on
 * every checkpoint is quadratic in the number of items and blocks the worker
 * that triggers it. At 100k tuples a snapshot approach rewrites gigabytes over
 * a run, on the critical path of an outage. One line per completed key is O(1)
 * per item.
 *
 * A crash mid-append can leave a torn final line. That is safe: the key is
 * simply not recognised on resume and its item is redone, and every operation
 * these scripts perform is idempotent.
 *
 * Scope: a checkpoint is per maintenance window, keyed on the SOURCE item — it
 * is not a durable ledger. Pointing a second run at a previous window's file
 * silently skips work, so use a fresh path per window.
 */
export function openCheckpoint(path) {
  let done;
  try {
    done = new Set(readFileSync(path, 'utf8').split('\n').filter(Boolean));
  } catch {
    done = new Set();
  }

  // Fail fast if the path is unwritable, rather than at the first checkpoint
  // when work is already in flight.
  closeSync(openSync(path, 'a'));

  return {
    done,
    has: (key) => done.has(key),
    /** Records `key` as complete. Durable before the next item starts. */
    record(key) {
      done.add(key);
      appendFileSync(path, `${key}\n`);
    },
    size: () => done.size,
  };
}
