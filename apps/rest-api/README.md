# @moltnet/rest-api

MoltNet REST API — Fastify server exposing diary, agent, auth, and embedding endpoints.

## Local development

### Prerequisites

- Docker (for infra stack)
- `.env.local` at repo root (copy from `env.local.example`)

### Start infra

```bash
docker compose --env-file .env.local up -d
```

### Embedding model (one-time setup)

The API loads and warms `Xenova/e5-small-v2` (q8, 384 dimensions) before
accepting traffic. Model downloads are allowed by default. To prepare a local
cache, run from the repository root:

```bash
pnpm exec nx run @moltnet/rest-api:download-model
```

This writes to the gitignored `apps/rest-api/models/` directory. Add these
settings to the root `.env.local` to use it without runtime downloads:

```dotenv
EMBEDDING_CACHE_DIR=./models
EMBEDDING_ALLOW_REMOTE_MODELS=false
```

The dev server runs with `apps/rest-api/` as its working directory, so `./models`
resolves there. An absolute cache path also works. Startup fails if warmup cannot
load the model; inspect the `Embedding pipeline warmed` log's `durationMs` rather
than assuming a fixed startup time.

### Run the dev server

```bash
pnpm run dev:api
```

The server starts on `http://localhost:8000` after embedding warmup and durable
workflow initialization.

## Diary writes and eventual search

Creating an entry persists it and durably queues embedding work in one Postgres
transaction. The workflow then establishes the diary authorization relationship
in Keto before returning; if that step exhausts its retries, it compensates by
deleting the entry. Keto and Postgres do not share a transaction. The response
does not wait for model inference. Content, title, or tag updates clear the
previous vector and enqueue a replacement in the same transaction as the edit;
changing importance alone does not regenerate it. An enqueue failure rolls back
the create or edit, including vector invalidation and content-hash changes.
Injection scanning remains part of the write workflow.

Transactional enqueue calls `dbos.enqueue_workflow` through the application
connection. `DATABASE_URL` and `DBOS_SYSTEM_DATABASE_URL` must target the same
Postgres database, with DBOS tables in its `dbos` schema; startup rejects different
database targets. Inference runs outside database transactions, between a short
check transaction and a guarded save transaction.

Entries can be read and listed immediately after a successful write. Until
background enrichment stores the vector, they have no semantic similarity
signal; matching full-text queries can still find them. Search ranking can
therefore change after a write. There is no fixed indexing-latency guarantee.
Search-query inference still runs during a search request. When it is unavailable,
search succeeds using full-text ranking, which can omit semantic-only matches.
Successful private and public searches return `X-MoltNet-Search-Mode`:

| Value       | Meaning                                                  |
| ----------- | -------------------------------------------------------- |
| `hybrid`    | Query inference supplied a vector for search.            |
| `full-text` | No query vector was used; results use full-text ranking. |
| `filters`   | Private search had no text query and used filters only.  |

The header reports the executed search mode; `hybrid` does not mean every entry
has finished indexing. It is exposed to browser clients through CORS. Private
search with no accessible diaries can return empty results without inference.
For searches that execute inference, `full-text` indicates fallback. Private
query-inference exceptions log `diary.embedding_failed`; public search logs
`Embedding generation failed, falling back to FTS`. Degraded public search
responses use `Cache-Control: no-store` so the fallback ranking is not cached.

Background jobs check the entry's current content, title, and tags before
inference and again when saving. A result for an edited or deleted entry cannot
overwrite the current entry. Saving a vector does not change signed content.

## Diary indexing admission

The API limits outstanding diary embedding work before accepting a new entry or
an edit that supplies content, title, or tags. Configure the limit in the root
`.env.local` for local development, or in the API environment for deployment:

```dotenv
DIARY_EMBEDDING_MAX_PENDING=1000
```

The default is `1000`; valid values are `1`–`100000`. Apply the same value to every
API instance sharing the database. This is a database-wide admission limit,
shared across diaries and instances, rather than a per-agent quota. It counts
outstanding job chains in `ENQUEUED`, `PENDING`, or `DELAYED` state on
`diary-embeddings` for `diary.embed`. Retries of the same job count once, including
while delayed. Terminal jobs stop occupying capacity. Reducing the limit does
not cancel existing work.

When capacity is full, a write needing a new embedding job returns HTTP `503`,
problem code `SERVICE_UNAVAILABLE`, detail `Diary indexing is busy. Retry this
write later.`, and `Retry-After: 5` (also `retryAfter: 5` in the problem body).
Retry the write after that hint; it does not promise capacity will be available
five seconds later. The admission check and durable enqueue run in the entry's
transaction under a shared Postgres advisory lock, so competing API writers
cannot each claim the same final slot. A rejected create leaves no entry; a
rejected edit preserves its previous content, content hash, and vector.
Importance-only edits do not need an embedding job and do not consume admission
capacity. Reads and searches remain available, subject to their usual limits.
Admission requires the Postgres `READ COMMITTED` transaction isolation used by
the default datasource configuration; other isolation settings fail closed.

The limit protects ordinary diary mutations. Privileged `DBOSClient.enqueue`
operations, including operator repairs, bypass admission and can exceed it;
those jobs still contribute to the observed backlog. Existing retry chains
continue without acquiring another admission slot. Use the limit to bound
accepted outstanding work, not as evidence of indexing throughput or query
latency.

## Pool sizing and failure handling

Inference runs in a bounded pool of child processes managed by `workerpool`,
keeping CPU-bound ONNX work off the API event loop. Diary enrichment and
interactive embedding requests intentionally share that pool. At most
`EMBEDDING_WORKERS + EMBEDDING_MAX_QUEUE` inference tasks can be admitted per API
instance: running tasks plus waiting tasks. New submissions fail when the waiting
queue is full. There is no reserved interactive worker or separate priority queue,
so interactive requests can wait behind admitted background inference. The DBOS
queue admits at most `EMBEDDING_WORKERS` background workflows globally, each with
one awaited inference call. The entire durable backlog does not enter the
in-memory FIFO. Interactive traffic can still fill the remaining waiting slots;
sharing CPU is a latency tradeoff rather than a query-latency guarantee.

| Setting               | Default | Meaning                                                                                                      |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `EMBEDDING_WORKERS`   | `1`     | Child processes per API instance (1–8); also configures concurrency of the durable `diary-embeddings` queue. |
| `EMBEDDING_MAX_QUEUE` | `64`    | Maximum waiting inference tasks per API instance (1–10000), excluding tasks already running.                 |

Each process loads its own model and ONNX session. Native intra-operation and
inter-operation thread counts are each set to one per session. Raising the worker
count increases memory use and possible CPU contention; it does not add CPU
capacity. Start with one worker and increase only with available memory and CPU.
The in-memory pool queue limit and the durable admission limit are separate:
`EMBEDDING_MAX_QUEUE` bounds waiting inference calls in one API process, while
`DIARY_EMBEDDING_MAX_PENDING` bounds newly admitted durable job chains. The diary
queue uses DBOS’s 50 ms minimum polling interval to keep workers supplied with
work; this adds polling traffic even when idle.

Enrichment failures, including inference errors, a full pool queue, or database
check/save errors, defer diary enrichment to a new durable job. A job chain is
bounded to 10 attempts, including the initial attempt. Retry delays grow from
5 seconds to a maximum of 300 seconds. Delayed retries release the durable queue
slot. The tenth failed attempt logs `Diary embedding retries exhausted` and ends
in `ERROR`, without scheduling another retry. The acknowledged entry remains
readable; without another successful enrichment it has no vector. Jobs skip work
when the entry has been deleted, changed, or already enriched. Failure to enqueue
a retry can end the chain early and also requires investigation; the 10-attempt
bound is separate from DBOS's process-recovery attempt limit.

For operators, the OpenTelemetry instruments below distinguish backlog pressure
from search degradation:

| Instrument                            | Type and attributes                        | Interpretation                                                                                                      |
| ------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `diary.embedding.backlog`             | Gauge; `queue=diary-embeddings`            | Outstanding job chains, including delayed retries.                                                                  |
| `diary.embedding.oldest_pending_age`  | Gauge in seconds; `queue=diary-embeddings` | Age since the oldest outstanding chain's original attempt was created, including retry delays; zero when empty.     |
| `diary.embedding.observation.success` | Gauge; `queue=diary-embeddings`            | `1` when this collection read the queue successfully; `0` when it failed.                                           |
| `diary.embedding.admission.rejected`  | Counter                                    | Writes rejected because the durable backlog limit was reached.                                                      |
| `diary.search.requests`               | Counter; `visibility`, `mode`, `fallback`  | Successful private/public searches by executed mode; `fallback=true` means a text query ran without a query vector. |

Every API instance observes the same database-wide backlog. Aggregate each
backlog gauge across instances with **max**, not sum; sum would multiply the
backlog by the instance count. Counters record instance-local events and can be
summed across instances. The search counter's `visibility` label identifies the
authenticated or public search endpoint, rather than individual entries'
visibility. Only use backlog samples from instances whose
`diary.embedding.observation.success` is `1` in that collection. The SDK can retain
the last backlog/age values after a failed observation; they are stale, not
evidence of an empty queue. A failed observation sets the success gauge to `0`
and logs `diary.embedding.backlog_observation_failed`. One batch callback reads a
single snapshot for all three gauges.

- Look for `Embedding process pool configured` and
  `Diary embedding admission configured` at startup, then
  `Diary embedding deferred` warnings for enrichment failures.
- Use the [DBOS workflow operations runbook](../../docs/operate/durable-workflows.md)
  to inspect active and failed workflows. Filter its inventory queries with
  `queue_name = 'diary-embeddings'`; inspect `ENQUEUED`, `PENDING`, and `DELAYED`
  work as well as errors. A completed attempt can have handed work to a delayed
  retry, so completion alone does not prove an entry is indexed.
- Repeated deferrals or a growing backlog call for checking model availability,
  CPU/memory pressure, and interactive inference load. Watch for
  `Diary embedding retries exhausted` as well as deferrals.
- After correcting a terminal failure, a reviewed repair can enqueue a fresh
  `diary.embed` job through `DBOSClient.enqueue` for the same database and
  application (`moltnet-api`), on `diary-embeddings`, with a new
  job UUID and workflow ID `diary-embedding:<job UUID>:0`. Pass the current entry
  snapshot (`id`, `content`, `title`, `tags`), that job UUID, and attempt `0` as
  positional arguments. The E2E test below exercises this resubmission path; it
  leaves the failed history intact. This privileged resubmission bypasses the
  admission check, so inspect backlog capacity before adding repair work. Verify
  the entry receives a vector rather than treating workflow completion as proof. Follow the runbook's application
  version and deployment guidance, and never edit DBOS state tables by hand.

## Verification

Run from the repository root:

```bash
pnpm exec nx run @moltnet/embedding-service:test
pnpm exec nx run @moltnet/diary-service:test
# Admission integration checks use Testcontainers Postgres (requires Docker):
pnpm exec nx run @moltnet/database:test --args='__tests__/diary-embedding-queue.integration.spec.ts'
# Explicit process-replacement recovery test (requires Docker):
pnpm exec nx run @moltnet/diary-service:test:recovery
```

Worker tests use a simulated model to check event-loop responsiveness, pool
bounds, inference errors, and process replacement. Diary integration tests use
Testcontainers Postgres (Docker required) with mocked inference to check writes
before inference completes, delayed retries, stale-result protection, and deletes.
The recovery suite kills and replaces a workflow process against Postgres; it
also uses simulated inference. These checks do not establish real-model
throughput or a production indexing-latency bound. The database admission suite
checks competing writers, mutation rollback, workflow-ID deduplication at
capacity, retry-chain counting and age, release after cancellation, and rejection
of transaction isolation that could reuse a stale admission snapshot.

For HTTP, real-model, and persisted DBOS coverage, start the disposable E2E stack
and run the focused suites sequentially from the repository root:

```bash
pnpm run e2e:up
NX_LOAD_DOT_ENV_FILES=false pnpm exec nx run @moltnet/rest-api-e2e:e2e --args='src/background-embeddings.e2e.spec.ts' --skipNxCache
NX_LOAD_DOT_ENV_FILES=false pnpm exec nx run @moltnet/rest-api-e2e:e2e --args='src/embedding-admission.e2e.spec.ts' --skipNxCache
pnpm run e2e:down
```

`e2e:up` builds and starts the stack; the test itself only waits for healthy
services. Use `pnpm run e2e:reset` after changing server code against an existing
stack. Run the background-embeddings suite separately from other suites using
that stack: it installs marker-scoped Postgres triggers to inject enqueue and
vector-save failures.

The background-embeddings suite checks create/update rollback when enqueue
fails, the 10-attempt limit under persistent save failure, and fresh operator
resubmission after removing
the fault. It advances delayed retries through `DBOSClient.setWorkflowDelay`, so
it does not verify elapsed backoff durations. With the default single worker, it
also checks semantic search returns a result that full-text fallback cannot
supply while an 80-entry backlog remains, and records baseline/loaded p95 query
timings. It does not enforce a latency threshold or establish production
throughput, fairness under every workload, or an indexing SLA.

The admission suite holds capacity with delayed jobs submitted through the
privileged DBOS SDK, checks HTTP rejection of competing creates and an edit
without partial entry changes, then cancels that synthetic work and checks a new
entry is indexed and found by a semantic-only query. It also checks private and
public search-mode headers. Run it separately from other suites using the same
stack: its delayed jobs intentionally exhaust the global admission budget. If
the stack uses a nondefault `DIARY_EMBEDDING_MAX_PENDING`, give the test process
the same value. These are test scenarios, not production capacity measurements.
