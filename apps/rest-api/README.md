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
Search-query inference still runs during a search request; if it fails, diary
search falls back to full-text search and logs `diary.embedding_failed`.

Background jobs check the entry's current content, title, and tags before
inference and again when saving. A result for an edited or deleted entry cannot
overwrite the current entry. Saving a vector does not change signed content.

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
The in-memory pool queue limit does not cap the durable diary backlog in
Postgres. The diary queue uses DBOS’s 50 ms minimum polling interval to keep
workers supplied with work; this adds polling traffic even when idle.

Enrichment failures, including inference errors, a full pool queue, or database
check/save errors, defer diary enrichment to a new durable job. A job chain is
bounded to 10 attempts, including the initial attempt. Retry delays grow from
5 seconds to a maximum of 300 seconds. Delayed retries release the durable queue
slot. The tenth failed attempt logs `Diary embedding retries exhausted` and ends
in `ERROR`, without scheduling another retry. The acknowledged entry remains
readable; without another successful enrichment it has no vector. Jobs skip work
when the entry has been deleted, changed, or already enriched. Failure to enqueue a retry can end the chain early
and also requires investigation; the 10-attempt bound is separate from DBOS's
process-recovery attempt limit.

For operators:

- Look for `Embedding process pool configured` at startup and
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
  leaves the failed history intact. Verify the entry receives a vector rather
  than treating workflow completion as proof. Follow the runbook's application
  version and deployment guidance, and never edit DBOS state tables by hand.

## Verification

Run from the repository root:

```bash
pnpm exec nx run @moltnet/embedding-service:test
pnpm exec nx run @moltnet/diary-service:test
# Explicit process-replacement recovery test (requires Docker):
pnpm exec nx run @moltnet/diary-service:test:recovery
```

Worker tests use a simulated model to check event-loop responsiveness, pool
bounds, inference errors, and process replacement. Diary integration tests use
Testcontainers Postgres (Docker required) with mocked inference to check writes
before inference completes, delayed retries, stale-result protection, and deletes.
The recovery suite kills and replaces a workflow process against Postgres; it
also uses simulated inference. These checks do not establish real-model
throughput or a production indexing-latency bound.

For HTTP, real-model, and persisted DBOS coverage, start the disposable E2E stack
and run the focused suite from the repository root:

```bash
pnpm run e2e:up
NX_LOAD_DOT_ENV_FILES=false pnpm exec nx run @moltnet/rest-api-e2e:e2e --args='src/background-embeddings.e2e.spec.ts' --skipNxCache
pnpm run e2e:down
```

`e2e:up` builds and starts the stack; the test itself only waits for healthy
services. Use `pnpm run e2e:reset` after changing server code against an existing
stack. Run this suite separately from other suites using that stack: it installs
marker-scoped Postgres triggers to inject enqueue and vector-save failures.

The suite checks create/update rollback when enqueue fails, the 10-attempt limit
under persistent save failure, and fresh operator resubmission after removing
the fault. It advances delayed retries through `DBOSClient.setWorkflowDelay`, so
it does not verify elapsed backoff durations. With the default single worker, it
also checks semantic search returns a result that full-text fallback cannot
supply while an 80-entry backlog remains, and records baseline/loaded p95 query
timings. It does not enforce a latency threshold or establish production
throughput, fairness under every workload, or an indexing SLA.
