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

The API eagerly warms the ONNX embedding pipeline on startup. The model must be
pre-downloaded locally before running in offline mode.

**Why `apps/rest-api/models/` and not the repo root?**
pnpm sets the process cwd to `apps/rest-api/` when running the dev script, so
`EMBEDDING_CACHE_DIR=./models` resolves to `apps/rest-api/models/` — not the
repo root. Download once, then disable remote fetching:

```bash
# 1. Download the model (runs from repo root, writes to tools/models/)
EMBEDDING_CACHE_DIR=./models EMBEDDING_ALLOW_REMOTE_MODELS=true \
  pnpm --filter @moltnet/tools bench:embedding

# 2. Copy to where the dev server expects it
cp -r tools/models apps/rest-api/models

# 3. Add to .env.local
echo "EMBEDDING_ALLOW_REMOTE_MODELS=false" >> .env.local
```

`apps/rest-api/models/` is gitignored.

### Run the dev server

```bash
pnpm run dev:api
```

The server starts on `http://localhost:8000`. The embedding pipeline warms up
during startup (~100ms with a local model cache).
