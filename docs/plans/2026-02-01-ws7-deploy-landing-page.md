# WS7 Phase 1: Deploy Landing Page to Fly.io

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy the MoltNet landing page to Fly.io so `themolt.net` serves the landing page publicly.

**Architecture:** A thin Fastify server (`apps/server/`) serves the pre-built landing page static files via `@fastify/static` with SPA fallback. A multi-stage Dockerfile builds the landing page (Vite) then the server (tsc), producing a slim Node.js image. GitHub Actions builds the image to GHCR and deploys to Fly.io on push to main + manual dispatch.

**Tech Stack:** Fastify 5, `@fastify/static`, `@moltnet/observability`, Vite (landing build), Docker multi-stage, Fly.io (Frankfurt), GitHub Actions, GHCR.

**Reference issue:** https://github.com/getlarge/themoltnet/issues/42

---

### Task 1: Add `@fastify/static` to the dependency catalog

**Files:**

- Modify: `pnpm-workspace.yaml` (add catalog entry)

**Step 1: Add catalog entry**

In `pnpm-workspace.yaml`, add under the `# Fastify` section:

```yaml
'@fastify/static': ^9.0.0
```

Place it after the `'@fastify/otel': ^0.16.0` line, keeping the Fastify section grouped.

**Step 2: Verify**

Run: `grep '@fastify/static' pnpm-workspace.yaml`
Expected: `  '@fastify/static': ^9.0.0`

---

### Task 2: Create `apps/server/` package scaffold

**Files:**

- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`

**Step 1: Create package.json**

```json
{
  "name": "@moltnet/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "types": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@fastify/static": "catalog:",
    "@moltnet/observability": "workspace:*",
    "@sinclair/typebox": "catalog:",
    "fastify": "catalog:"
  },
  "devDependencies": {
    "pino-pretty": "catalog:",
    "tsx": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

**Step 2: Create tsconfig.json**

Follow the pattern from `apps/rest-api/tsconfig.json` — extend root, set outDir/rootDir:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

**Step 3: Install deps**

Run: `pnpm install`
Expected: lockfile updates, workspace symlinks created for `@moltnet/server`.

---

### Task 3: Write server config module

**Files:**

- Create: `apps/server/src/config.ts`

**Step 1: Create config.ts**

Follow the pattern from `apps/rest-api/src/config.ts` — TypeBox validation of env vars:

```typescript
import type { Static, TObject } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const ServerConfigSchema = Type.Object({
  PORT: Type.Number({ default: 8080 }),
  NODE_ENV: Type.Union(
    [
      Type.Literal('development'),
      Type.Literal('production'),
      Type.Literal('test'),
    ],
    { default: 'development' },
  ),
  STATIC_DIR: Type.Optional(Type.String({ minLength: 1 })),
});

export type ServerConfig = Static<typeof ServerConfigSchema>;

function pickEnv(
  schema: TObject,
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(schema.properties)) {
    if (key in env && env[key] !== undefined && env[key] !== '') {
      raw[key] = env[key];
    }
  }
  return raw;
}

export function loadServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  const raw = pickEnv(ServerConfigSchema, env);
  const converted = Value.Convert(ServerConfigSchema, raw);
  const withDefaults = Value.Default(ServerConfigSchema, converted);
  if (Value.Check(ServerConfigSchema, withDefaults)) {
    return withDefaults;
  }
  const errors = [...Value.Errors(ServerConfigSchema, withDefaults)];
  const details = errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n');
  throw new Error(`Invalid server config:\n${details}`);
}
```

Notes:

- `PORT` defaults to 8080 (Fly.io internal port).
- `STATIC_DIR` is optional — defaults are resolved in `app.ts` based on runtime context.

---

### Task 4: Write the Fastify app factory

**Files:**

- Create: `apps/server/src/app.ts`

**Step 1: Create app.ts**

```typescript
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ServerConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  config: ServerConfig;
  logger?: boolean | object;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config, logger = true } = options;

  const app = Fastify({ logger });

  // Resolve static directory
  const staticDir = resolveStaticDir(config.STATIC_DIR);

  if (staticDir) {
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
    });

    // SPA fallback: serve index.html for any unmatched GET request
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET') {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Not Found' });
    });
  }

  // Health check
  app.get('/healthz', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  return app;
}

function resolveStaticDir(configDir?: string): string | null {
  if (configDir) {
    if (!existsSync(configDir)) {
      throw new Error(`STATIC_DIR does not exist: ${configDir}`);
    }
    return configDir;
  }

  // Default paths to try (Docker, then local dev)
  const candidates = [
    path.resolve('/app/public'),
    path.resolve(__dirname, '../../../landing/dist'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
```

Notes:

- `resolveStaticDir` tries Docker path first (`/app/public`), then local dev path (`../../../landing/dist` relative to `apps/server/src/`).
- SPA fallback only for GET requests — POST/PUT/etc return 404.
- `/healthz` is always available regardless of static files.
- Observability can be added later by importing `initObservability` and registering plugins. Keeping it out of Phase 1 to minimize moving parts for the first deploy.

---

### Task 5: Write the server entry point

**Files:**

- Create: `apps/server/src/index.ts`

**Step 1: Create index.ts**

```typescript
import { loadServerConfig } from './config.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadServerConfig();

  const app = await buildApp({
    config,
    logger:
      config.NODE_ENV === 'production'
        ? true
        : { transport: { target: 'pino-pretty' } },
  });

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.fatal(err, 'Failed to start server');
    process.exit(1);
  }
}

main();
```

Notes:

- Binds to `0.0.0.0` — required for Docker/Fly.io containers.
- Pretty logging in dev, structured JSON in production.

**Step 2: Verify build**

Run: `pnpm --filter @moltnet/server run build`
Expected: `dist/` created with compiled JS.

**Step 3: Verify dev server starts**

Build the landing page first, then start the server:

Run: `pnpm --filter @moltnet/landing run build && pnpm --filter @moltnet/server run dev`
Expected: Server starts on port 8080, serves landing page at `http://localhost:8080/`, `/healthz` returns `{"status":"ok","timestamp":"..."}`.

Stop the dev server after verifying.

**Step 4: Commit**

```bash
git add apps/server/ pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(server): add combined server with @fastify/static for landing page

Phase 1 of WS7 — serves landing page as static files with SPA fallback
and /healthz health check. Ready for Phase 2 REST API route mounting."
```

---

### Task 6: Write the Dockerfile

**Files:**

- Create: `apps/server/Dockerfile`

**Step 1: Create Dockerfile**

Follow the pattern from the existing Dockerfiles (`apps/landing/Dockerfile`, `apps/rest-api/Dockerfile`) and the baume reference. Multi-stage build:

```dockerfile
# @moltnet/server — Multi-stage Dockerfile
#
# Build from repo root:
#   docker build -f apps/server/Dockerfile .

# ---------- base ----------
FROM node:20-slim AS base
ARG NPM_STRICT_SSL=true
RUN npm config set strict-ssl ${NPM_STRICT_SSL} && npm install -g pnpm@10.28.1
WORKDIR /app

# ---------- deps ----------
FROM base AS deps

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./

# Copy all workspace package.json files to leverage Docker layer caching
COPY apps/server/package.json apps/server/
COPY apps/landing/package.json apps/landing/
COPY apps/rest-api/package.json apps/rest-api/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY libs/observability/package.json libs/observability/
COPY libs/crypto-service/package.json libs/crypto-service/
COPY libs/database/package.json libs/database/
COPY libs/design-system/package.json libs/design-system/
COPY libs/models/package.json libs/models/
COPY libs/auth/package.json libs/auth/
COPY libs/diary-service/package.json libs/diary-service/
COPY libs/api-client/package.json libs/api-client/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build ----------
FROM deps AS build

# Copy all source (design-system exports src, needed by landing Vite build)
COPY . .

# Build landing page (Vite → static files)
RUN pnpm --filter @moltnet/landing run build

# Build server (tsc → dist/)
RUN pnpm --filter @moltnet/server run build

# ---------- production ----------
FROM base AS production

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./

# Server dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules

# Landing page build output → /app/public
COPY --from=build /app/apps/landing/dist ./public

# Workspace libs source (resolved via pnpm workspace symlinks → src)
COPY --from=build /app/libs ./libs

WORKDIR /app/apps/server

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:8080/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
```

Notes:

- Landing page build output copied to `/app/public` (matched by `resolveStaticDir` in `app.ts`).
- Libs source copied because workspace exports point to `./src/index.ts`.
- Port 8080 matches the default PORT in config.

**Step 2: Test Docker build**

Run: `docker build -f apps/server/Dockerfile -t moltnet-server .`
Expected: Build succeeds (all 4 stages complete).

**Step 3: Test Docker run**

Run: `docker run --rm -p 8080:8080 moltnet-server`
Expected: Server starts, `http://localhost:8080/` serves landing page, `http://localhost:8080/healthz` returns OK.

Stop the container after verifying.

**Step 4: Commit**

```bash
git add apps/server/Dockerfile
git commit -m "feat(server): add multi-stage Dockerfile for Fly.io deployment"
```

---

### Task 7: Create fly.toml

**Files:**

- Create: `apps/server/fly.toml`

**Step 1: Create fly.toml**

Follow the pattern from baume-mcp's fly.toml:

```toml
# Fly.io configuration for MoltNet combined server
# See https://github.com/getlarge/themoltnet/issues/42

app = "moltnet"
primary_region = "fra"  # Frankfurt — EU data residency

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"
  NODE_ENV = "production"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
  processes = ["app"]

  [http_service.concurrency]
    type = "requests"
    hard_limit = 250
    soft_limit = 200

[[http_service.checks]]
  grace_period = "30s"
  interval = "30s"
  method = "GET"
  path = "/healthz"
  timeout = "5s"

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1
```

Notes:

- App name `moltnet` — will be created via `fly launch`.
- Frankfurt region (`fra`) for EU data residency per issue spec.
- Auto-stop enabled — scales to zero when idle (saves cost on free tier).
- Health check on `/healthz`.
- Minimal VM: shared CPU, 256MB.

**Step 2: Commit**

```bash
git add apps/server/fly.toml
git commit -m "feat(server): add fly.toml for Frankfurt deployment"
```

---

### Task 8: Create Fly.io app and do initial deploy

This task uses flyctl to create the app and deploy.

**Step 1: Create the Fly.io app**

Run from `apps/server/`:

```bash
cd apps/server && fly apps create moltnet --org personal
```

If `moltnet` is taken, try `themoltnet`.

Expected: App created successfully.

**Step 2: Deploy**

Run from repo root (Dockerfile context is repo root):

```bash
fly deploy --config apps/server/fly.toml --dockerfile apps/server/Dockerfile --remote-only
```

Expected: Docker image built on Fly.io builders, deployed to Frankfurt, health check passes.

**Step 3: Verify**

Run: `fly status --config apps/server/fly.toml`
Expected: App running, 1 machine in `fra`.

Test: `curl https://moltnet.fly.dev/healthz`
Expected: `{"status":"ok","timestamp":"..."}`

Test: Open `https://moltnet.fly.dev/` in browser — landing page loads.

**Step 4: Commit fly.toml app name if it changed**

If the app name changed from `moltnet`, update `fly.toml` and commit.

---

### Task 9: Create GitHub Actions deploy workflow

**Files:**

- Create: `.github/workflows/deploy.yml`

**Step 1: Create deploy.yml**

Follow the baume `mcp-server-deploy.yml` pattern — build to GHCR, then deploy pre-built image to Fly.io:

```yaml
name: Deploy

on:
  push:
    branches: [main]
    paths:
      - 'apps/server/**'
      - 'apps/landing/**'
      - 'libs/**'
      - 'pnpm-lock.yaml'
      - '.github/workflows/deploy.yml'
  workflow_dispatch:
    inputs:
      deploy:
        description: 'Deploy to Fly.io'
        required: false
        default: true
        type: boolean

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository_owner }}/moltnet
  FLY_APP: moltnet

jobs:
  build:
    name: Build
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    outputs:
      image_digest: ${{ steps.build.outputs.digest }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=sha,prefix=
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/server/Dockerfile
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    name: Deploy to Fly.io
    needs: build
    runs-on: ubuntu-latest
    if: >-
      github.ref == 'refs/heads/main' &&
      (github.event_name == 'push' || github.event.inputs.deploy == 'true')

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Fly.io CLI
        uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
        working-directory: apps/server
        run: >-
          flyctl deploy
          --remote-only
          --image ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ needs.build.outputs.image_digest }}
```

Notes:

- Path filter: triggers on changes to server, landing, or any lib (libs could affect landing build).
- `workflow_dispatch` with `deploy` input defaults to `true` (manual deploys always go to Fly.io).
- Two-job pipeline: build + push to GHCR, then deploy the exact image digest to Fly.io.
- Requires `FLY_API_TOKEN` secret in GitHub repo settings.

**Step 2: Set up GitHub secret for FLY_API_TOKEN**

Run: `fly tokens create deploy -a moltnet`

Copy the token and add it as a GitHub Actions secret named `FLY_API_TOKEN`:

Run: `gh secret set FLY_API_TOKEN` (paste the token when prompted)

**Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add deploy workflow for Fly.io via GHCR

Auto-deploys on push to main when server/landing/libs change.
Manual deploy available via workflow_dispatch."
```

---

### Task 10: Add `dev:server` script to root and update .dockerignore

**Files:**

- Modify: `package.json` (root — verify dev:server script exists)
- Modify: `.dockerignore` (ensure test-results excluded)

**Step 1: Verify root dev:server script**

The root `package.json` already has `"dev:server": "pnpm --filter @moltnet/server dev"`. No change needed.

**Step 2: Update .dockerignore**

Add `test-results` to `.dockerignore` (it's listed as untracked in git status):

```
# Test results
test-results
```

Add this after the existing `# Test & coverage` section.

**Step 3: Commit**

```bash
git add .dockerignore
git commit -m "chore: add test-results to .dockerignore"
```

---

### Task 11: Set up custom domain (DNS + TLS)

This task configures `themolt.net` to point to the Fly.io app.

**Step 1: Add certificate to Fly.io**

Run: `fly certs create themolt.net --config apps/server/fly.toml`

This outputs DNS records you need to set.

**Step 2: Add CNAME/A records**

The exact records depend on your DNS provider. Typically:

- `themolt.net` → CNAME to `moltnet.fly.dev` (or A record to Fly.io IP if apex domain)
- For apex domains, Fly.io provides dedicated IPv4/IPv6 addresses.

Run: `fly ips list --config apps/server/fly.toml` to get the IPs.

Set DNS records at your registrar:

- A record: `@` → Fly.io IPv4
- AAAA record: `@` → Fly.io IPv6

**Step 3: Verify TLS**

Run: `fly certs show themolt.net --config apps/server/fly.toml`

Wait for certificate to be issued (may take a few minutes).

Test: `curl https://themolt.net/healthz`
Expected: `{"status":"ok","timestamp":"..."}`

---

### Task 12: Write tests for the server

**Files:**

- Create: `apps/server/__tests__/app.test.ts`

**Step 1: Write tests**

```typescript
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

describe('server app', () => {
  it('should return health check', async () => {
    const app = await buildApp({
      config: { PORT: 0, NODE_ENV: 'test' },
      logger: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();

    await app.close();
  });

  it('should return 404 for non-GET requests when no static dir', async () => {
    const app = await buildApp({
      config: { PORT: 0, NODE_ENV: 'test' },
      logger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/nonexistent',
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
```

**Step 2: Run tests**

Run: `pnpm --filter @moltnet/server run test`
Expected: 2 tests pass.

**Step 3: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass including the new server tests.

**Step 4: Commit**

```bash
git add apps/server/__tests__/
git commit -m "test(server): add health check and 404 tests"
```

---

### Task 13: Run full validation and final commit

**Step 1: Typecheck**

Run: `pnpm run typecheck`
Expected: No errors.

**Step 2: Lint**

Run: `pnpm run lint`
Expected: No errors (or fix any that appear).

**Step 3: Test**

Run: `pnpm run test`
Expected: All tests pass.

**Step 4: Build**

Run: `pnpm run build`
Expected: All workspaces build successfully.

---

## Summary of files created/modified

**Created:**

- `apps/server/package.json`
- `apps/server/tsconfig.json`
- `apps/server/src/config.ts`
- `apps/server/src/app.ts`
- `apps/server/src/index.ts`
- `apps/server/Dockerfile`
- `apps/server/fly.toml`
- `apps/server/__tests__/app.test.ts`
- `.github/workflows/deploy.yml`
- `docs/plans/2026-02-01-ws7-deploy-landing-page.md`

**Modified:**

- `pnpm-workspace.yaml` (added `@fastify/static` to catalog)
- `pnpm-lock.yaml` (auto-updated)
- `.dockerignore` (added `test-results`)

## Post-plan: Phase 2 preparation

When WS3 (diary-service) and WS4 (auth library) are ready, extending the server is straightforward:

1. Add `@moltnet/rest-api` as a workspace dependency
2. Import `buildApp` from `@moltnet/rest-api` in `apps/server/src/app.ts`
3. Mount it as a Fastify plugin under `/api/v1/` prefix
4. Add observability via `@moltnet/observability`
5. Add Fly.io secrets for database, Ory, Axiom
