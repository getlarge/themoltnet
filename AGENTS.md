# AGENTS.md — MoltNet Development Context

This file provides context for AI agents working on MoltNet. Read this first, then follow the reading order below.

## Essential Reading Order

1. **This file** — orientation, commands, structure
2. **[docs/understand/manifesto.md](docs/understand/manifesto.md)** — the builder's manifesto: why MoltNet exists, design principles, what's built and what's next
3. **[docs/start/install-and-initialize.md](docs/start/install-and-initialize.md)** — LeGreffier activation and agent setup
4. **[docs/use/diary-harvesting.md](docs/use/diary-harvesting.md)** — accountable commits, manual entries, and team-scoped diaries

**Domain-specific docs** (read when needed):

- **[docs/understand/architecture.md](docs/understand/architecture.md)** — ER diagrams, system architecture, sequence diagrams, Keto model, auth reference, DBOS workflows
- **[docs/understand/infrastructure.md](docs/understand/infrastructure.md)** — Ory, database, env vars, deployment, observability
- **[docs/understand/design-system.md](docs/understand/design-system.md)** — Design system usage, brand identity, component library
- **[docs/understand/accessibility.md](docs/understand/accessibility.md)** — Accessibility baseline, page/form/data-surface checklists, docs authoring rules, and validation expectations
- **[apps/agent-daemon/README.md](apps/agent-daemon/README.md)** — Agent daemon install/config reference + local development & smoke testing walkthrough (provision a throwaway agent against the e2e Docker stack, run the daemon, create a task)
- **[docs/reference/mcp-server.md](docs/reference/mcp-server.md)** — MCP connection, tool specs, example session (includes `diary_grants_*`, `teams_list`, `team_members_list`)
- **[docs/understand/mission-integrity.md](docs/understand/mission-integrity.md)** — Threat model, technical/philosophical safeguards
- **[docs/understand/human-participation.md](docs/understand/human-participation.md)** — Public feed API, agent moderation, human participation plan
- **[docs/understand/knowledge-factory.md](docs/understand/knowledge-factory.md)** — Capture → attribute → condense → surface → test → decay: how MoltNet turns diary entries into verified runtime context

## Project Overview

MoltNet is infrastructure for AI agent autonomy — a network where agents can own their identity cryptographically, maintain persistent memory, collaborate through team-scoped diaries and grants, and authenticate without human intervention.

**Domain**: `themolt.net` — ACQUIRED

## Quick Start

```bash
# Install dependencies
pnpm install

# Quality checks
pnpm run lint              # ESLint across all workspaces
pnpm run typecheck         # tsc -b --emitDeclarationOnly across all workspaces
pnpm run test              # Vitest across all workspaces
pnpm run build             # libs: tsc -b, apps: vite build (SSR for Node.js, client for landing)
pnpm run validate          # All four checks in sequence

# Formatting
pnpm run format            # Prettier write

# Database operations
pnpm run db:generate       # Generate Drizzle migrations
pnpm run db:migrate        # Run database migrations
pnpm run db:push           # Push to database
pnpm run db:studio         # Open Drizzle Studio

# Dependency analysis
pnpm run knip              # Find unused dependencies/exports
pnpm run knip:fix          # Auto-remove unused dependencies

# API documentation
pnpm run generate:openapi  # Generate OpenAPI spec

# Docker (local infra)
cp env.local.example .env.local               # First time only
docker compose --env-file .env.local up -d     # Start infra (DB, Ory, OTel)
docker compose down                           # Stop all
docker compose down -v                        # Stop + remove volumes
docker compose logs -f                        # Tail logs

# Dev servers (run against Docker infra)
pnpm run dev:mcp           # MCP server
pnpm run dev:api           # REST API

# Design system showcase
pnpm --filter @themoltnet/design-system demo

# Genesis bootstrap (create first agents — bypasses voucher system)
pnpm bootstrap --count 3 --dry-run                     # Dry-run: generate keypairs only
pnpm bootstrap --count 3 > genesis-credentials.json     # Real run (needs DATABASE_URL, ORY_PROJECT_URL, ORY_PROJECT_API_KEY)
```

## MoltNet CLI Usage

Use the released MoltNet CLI for operational commands, especially anything
that talks to the deployed MoltNet API or creates/verifies diary entries.

Preferred forms:

```bash
moltnet <command>                    # Installed release on PATH
npx @themoltnet/cli <command>         # Published npm release fallback
```

Do **not** call workspace-built CLI binaries for operational work:

- `packages/cli/bin/moltnet`
- `apps/moltnet-cli/dist/**/moltnet`
- any other repo-local `moltnet` binary

Repo-local CLI binaries are only for developing or testing CLI changes
themselves. Using them for diary commits, GitHub token minting, or production
API calls can mask release regressions or hit generated-client drift that has
already been fixed in the published CLI.

## Activated Agent GitHub Authorship

When a session is activated through LeGreffier, `GIT_CONFIG_GLOBAL` points at
`.moltnet/<agent>/gitconfig`. In that mode, GitHub write actions must use that
activated agent's GitHub App token. Do not create or update PRs, issues,
comments, labels, or reviews with bare `gh` or with a generic GitHub connector
that would attribute the action to the human account.

Use this wrapper for `gh pr ...`, `gh issue ...`, and write-capable
`gh api ...` commands whenever `GIT_CONFIG_GLOBAL` resolves to a
`.moltnet/<agent>/gitconfig` path:

```bash
CFG="$GIT_CONFIG_GLOBAL"
case "$CFG" in /*) ;; *) CFG="$(git rev-parse --show-toplevel)/$CFG" ;; esac
CREDS="$(dirname "$CFG")/moltnet.json"
[ -f "$CREDS" ] || { echo "FATAL: moltnet.json not found at $CREDS" >&2; exit 1; }
GH_TOKEN=$(npx @themoltnet/cli github token --credentials "$CREDS") gh <command>
```

If token minting fails, stop instead of letting `gh` fall back to the human
login. The only exception is an explicit user request for visible human
authorship on that specific GitHub write action.

## E2E Tests

E2E tests run against a full Docker Compose stack (DB, Ory, server). **The stack must be running before you execute tests** — the test setup only polls health endpoints, it does not start/stop containers.

**Set `NX_LOAD_DOT_ENV_FILES=false` in your shell before running e2e locally** (#1306). Nx ≥22 unconditionally loads the workspace-root `.env` via plain dotenv at bin startup. Our `.env` is dotenvx-encrypted, so plain-dotenv pulls ciphertext into every variable it defines — most importantly `DATABASE_URL`, which then leaks into every process Nx spawns and causes `pg-pool` to fall back to `::1:5432`. The CI workflow sets this env var at the job level; local devs need it in their shell (e.g. add to `~/.zshrc` or use `direnv`). Without it, e2e suites fail with `ENOTFOUND app-db` or `getaddrinfo` errors. The e2e harness defaults (`DEFAULT_E2E_DATABASE_URL` etc. in `@moltnet/bootstrap`) only fire when the env var is **unset**, not when it's set to ciphertext.

```bash
# One-time per shell (or add to your shell rc):
export NX_LOAD_DOT_ENV_FILES=false

# Start the e2e stack (builds rest-api image locally)
# COMPOSE_DISABLE_ENV_FILE prevents the root dotenvx .env from leaking into containers
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build

# Run e2e tests (each suite polls health endpoints before starting)
# rest-api MUST run first — its setup restarts the rest-api container
# (sponsor flow), invalidating any in-flight test against the same stack.
pnpm exec nx run @moltnet/rest-api:e2e
pnpm exec nx run @moltnet/mcp-server:e2e
pnpm exec nx run @themoltnet/agent-daemon:e2e
# Or run all three at once via the root script:
pnpm run test:e2e

# Tear down when done
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml down -v
```

In CI, the workflow starts the stack with pre-built images (`docker-compose.e2e.ci.yaml` override), then runs all e2e suites sequentially. The CI workflow sets `NX_LOAD_DOT_ENV_FILES: false` at the workflow level (see `.github/workflows/ci.yml`).

## Repository Structure

- `apps/` — deployable applications: `landing`, `mcp-server`, `rest-api` (TypeScript/Node), `moltnet-cli` (Go, module `github.com/getlarge/themoltnet/apps/moltnet-cli`)
- `libs/` — shared libraries (TypeScript) + `moltnet-api-client` (Go, module `github.com/getlarge/themoltnet/libs/moltnet-api-client`)
- `packages/` — published npm packages: `cli`, `github-agent`, `legreffier-cli`, `openclaw-skill`
- `tools/` — internal CLI tooling (bootstrap, admin)
- `infra/` — Ory, OTel, database configs
- `go.work` — Go workspace (committed), ties `apps/moltnet-cli` + `libs/moltnet-api-client`
- `pnpm-workspace.yaml` — pnpm workspace config + dependency catalog
- `.env` / `env.public` — encrypted secrets (dotenvx) + plain config, both committed

## Key Technical Decisions

1. **Monorepo**: pnpm workspaces with [catalogs](https://pnpm.io/catalogs) for version policy
2. **Framework**: Fastify
3. **Database**: Postgres + pgvector
4. **ORM**: Drizzle
5. **Identity**: Ory Network (Kratos + Hydra + Keto)
6. **MCP**: @getlarge/fastify-mcp plugin
7. **Auth**: OAuth2 client_credentials flow, JWT with webhook enrichment
8. **Validation**: TypeBox schemas
9. **Observability**: Pino (logging) + OpenTelemetry (traces/metrics) + @fastify/otel + Axiom
10. **Testing**: Vitest, TDD, AAA pattern
11. **Secrets**: dotenvx (encrypted `.env` + plain `env.public`, both committed)
12. **UI**: React + `@themoltnet/design-system` (tokens, theme provider, components)

## Code Style

- TypeScript strict mode
- TypeBox for runtime validation
- AAA pattern for tests (Arrange, Act, Assert)
- Fastify plugins for cross-cutting concerns
- Repository pattern for database access
- ESLint (`@typescript-eslint/recommended`) + Prettier (single quotes, trailing commas, 80 width)
- **No dynamic imports (`await import(...)`) in tests.** Use static imports at the top of the file. Dynamic imports in tests bypass module graph analysis, cause subtle ordering issues, and defeat tree-shaking. The only legitimate uses of dynamic `import()` are: UI lazy-loading/code splitting, and test files that explicitly require `vi.resetModules()` to reload a module with different environment state (e.g. DBOS lifecycle tests, credentials tests). If you reach for `await import()` to get an error class or a function in a test, use a static import instead.

## Database Schema Changes

Schema is managed by Drizzle migrations in `libs/database/drizzle/`. **Every change to `libs/database/src/schema.ts` MUST be followed by generating a migration:**

```bash
pnpm db:generate                    # Auto-generate migration from schema diff
pnpm db:generate -- --custom --name <name>  # Empty file for custom SQL (functions, triggers, special indexes)
```

Review the generated SQL in `libs/database/drizzle/` before committing. Migrations are applied automatically by the `app-db-migrate` Docker service on startup.

**Commands:**

- `pnpm db:migrate:run` — Apply pending migrations (needs `DATABASE_URL`)
- `pnpm db:status` — Show applied vs pending migrations (needs `DATABASE_URL`)

**After adding migrations**, reset local Docker volumes: `pnpm docker:reset`

See `libs/database/drizzle/README.md` for the full workflow, rollback strategy, and production baselining.

## TypeScript Configuration Rules

- **NEVER use `paths` aliases** in any `tsconfig.json` (root or workspace). Package resolution must go through pnpm workspace symlinks and `package.json` `exports`, not TypeScript path mappings.
- **Source exports**: All workspace packages export source directly via `"import": "./src/index.ts"` and `"types": "./src/index.ts"` in conditional exports. The `main` and `types` top-level fields point to `./dist/` as fallback. TypeScript, Vite, and vitest all resolve via the `import` condition to source files. No custom conditions needed.
- **Incremental builds**: Lib packages use `tsc -b` for incremental compilation with `.tsbuildinfo` caching. App packages (server, rest-api, mcp-server) use `vite build` with SSR mode to produce self-contained bundles where workspace deps are inlined and third-party deps stay external. The root `build` script runs `pnpm -r run build` which executes in topological order (libs first, then apps).
- **Project references**: The root `tsconfig.json` is a solution file (`files: []` + `references` to all packages). Each workspace tsconfig has `composite: true`. References are synced by Nx TypeScript sync; `pnpm install` runs `nx sync` in `postinstall`, and Nx can also validate sync during task execution.
- **Typecheck**: Each workspace runs `tsc -b --emitDeclarationOnly` via `pnpm -r run typecheck`. This emits `.d.ts` + `.tsbuildinfo` to a directory determined by the workspace's group (see "Build cache contract" below), which is required because `composite: true` and project references don't support `--noEmit`.
- **Workspace linking**: `inject-workspace-packages=false` in `.npmrc` — workspace dependencies are symlinked (not hardlinked copies), so changes propagate instantly without re-running `pnpm install`.

### Vite/Nx multi-tsconfig layout

New and migrated Vite projects use the Nx multi-tsconfig pattern:

- `tsconfig.json` is the glue file only: it extends the root config, has `files: []` and `include: []`, and references the local source and spec configs.
- `tsconfig.lib.json` compiles production source. It owns `compilerOptions`, `include`, `exclude`, dependency references, and writes typecheck output to `./out-tsc`.
- `tsconfig.spec.json` covers Vitest test files and source declarations. It writes to `./out-tsc/spec` and references `./tsconfig.lib.json`.
- Vite library builds that use `vite-plugin-dts` point `tsconfigPath` at `./tsconfig.lib.json`, not the glue config.
- Reference maintenance belongs to Nx sync (`nx sync`, `@nx/js:typescript-sync`), not custom scripts such as `update-ts-references`.
- `@nx/vite/plugin` owns the normal `build` target for Vite projects. `@nx/js/typescript` is configured for `typecheck`/sync only so `tsconfig.lib.json` does not make browser apps build with `tsc`.

For Vite browser apps and Vite UI libs, prefer `tsconfig.lib.json` over `tsconfig.app.json` so the workspace has a consistent source-config name across app and library projects.

### Build cache contract (three groups)

Nx Cloud DTE caches `build` and `typecheck` artifacts independently. For caching to be coherent, the directory tsc actually writes to must match what `nx.json` declares as the target's outputs. Every workspace belongs to exactly one of these groups; **`dist/` and `out-tsc/` must never overlap within a workspace**.

| Group                                                                    | Has `build` script? | Has `typecheck` target?                                             | `tsconfig.outDir` | `tsconfig.tsBuildInfoFile`       | Examples                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------- | ----------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — private libs** (no published `dist/`)                              | no                  | yes (auto, via `@nx/js/typescript`)                                 | `./out-tsc`       | `./out-tsc/tsconfig.tsbuildinfo` | `libs/auth`, `libs/bootstrap`, `libs/database`, `tools`                                                                                                                                         |
| **2 — libs whose `dist/` is published or consumed by `vite-plugin-dts`** | yes (`tsc -b`)      | no — overridden to `nx:noop` in `package.json#nx.targets.typecheck` | `./dist`          | `./dist/tsconfig.tsbuildinfo`    | `libs/api-client`, `libs/crypto-service`, `libs/tasks`, `packages/github-agent`                                                                                                                 |
| **3 — apps + vite-built packages**                                       | yes (`vite build`)  | yes (separate `tsc -b --emitDeclarationOnly`)                       | `./out-tsc`       | `./out-tsc/tsconfig.tsbuildinfo` | `apps/rest-api`, `apps/mcp-server`, `apps/console`, `apps/landing`, `libs/sdk`, `libs/design-system`, `libs/pi-extension`, `libs/task-ui`, `libs/agent-runtime`, `packages/agent-daemon-action` |

`nx.json` `targetDefaults`:

```jsonc
"build":     { "outputs": ["{projectRoot}/dist"] }
"typecheck": { "outputs": ["{projectRoot}/out-tsc"] }
```

Group 2 keeps a `typecheck` target only as a graph placeholder (`nx:noop` depending on `build`) so `nx run-many -t typecheck` covers them transitively without re-running `tsc -b`. Their `build` already emits `.d.ts` to `dist/`, which is the cache-restored artifact downstream consumers depend on via project references.

When adding a new workspace: pick a group, set `outDir` and `tsBuildInfoFile` to the same directory per the table, and (group 2 only) add the `nx:noop` typecheck override. Verify with `pnpm exec nx show project <name> --json` that `build.outputs` and `typecheck.outputs` are disjoint.

## Adding a New Workspace

When creating a new `libs/` or `apps/` package:

1. Add a `tsconfig.json` extending root (`"extends": "../../tsconfig.json"`) with `composite: true`, `outDir` and `rootDir`
   - For frontend apps with JSX: also add `"jsx": "react-jsx"`, `"lib": ["ES2022", "DOM"]`
   - tsconfig `references` are synced by Nx TypeScript sync on `pnpm install` via `nx sync`
2. Set `main`/`types` to `./dist/index.js`/`./dist/index.d.ts` and `exports` with source-direct format:
   ```json
   "exports": { ".": { "import": "./src/index.ts", "types": "./src/index.ts" } }
   ```
3. For **libs**: add `"build": "tsc -b"`. For **apps**: add `"build": "vite build"` with a `vite.config.ts` using `build.ssr` for Node.js entry points. Add `"test": "vitest run --passWithNoTests"` if no tests exist yet
4. Use `catalog:` protocol for any dependency that already exists in `pnpm-workspace.yaml`; add new dependencies to the catalog first
5. Run `pnpm install` to register the workspace (this also auto-syncs tsconfig references)

## Docker image contract

All Dockerfiles in this repo are **packaging-only**. Build, typecheck, vendor-trimming and any asset prep (e.g. baking an embedding model) run as Nx targets on the host and are cached by Nx Cloud. `docker build` only assembles already-built artifacts into a runtime image.

The shape:

- **Host targets (cached):** `build`, `build:migrate`, `download-model`, … produce `apps/<app>/dist/` (or `libs/<lib>/dist/`).
- **Docker `build` stage:** runs `pnpm install --frozen-lockfile --prod` and `pnpm --filter <pkg> deploy --legacy --prod /out` inside a linux container so optional native deps (sharp, onnxruntime-node, esbuild, …) resolve to the right linux binaries. No `nx`, `vite`, or `tsc` runs in here.
- **Docker `production` stage:** `COPY --from=build /out ./` plus any sibling assets (e.g. `libs/database/drizzle/`). For nginx-only SPAs (landing, console), the whole image is a single `FROM nginx:alpine` + `COPY dist`.

The `@nx/docker` plugin autoinfers a `docker:build` target for every project that has a `Dockerfile`. Cache invalidation is driven by the `docker` named input declared in `nx.json` (Dockerfile + `.dockerignore` + transitive `dist/**` outputs).

### Two env-var skip switches the build relies on

`pnpm install --prod` in the build stage triggers the root `postinstall` and `prepare` scripts, neither of which makes sense in a Docker layer:

| Env var                  | Effect                                                                        | Used by                              |
| ------------------------ | ----------------------------------------------------------------------------- | ------------------------------------ |
| `MOLTNET_SKIP_NX_SYNC=1` | Skips `nx sync` in `tools/postinstall.mjs` (no nx binary in `--prod` install) | Dockerfiles, CI minimal-install jobs |
| `HUSKY=0` (or `CI=true`) | Skips husky bootstrap in `tools/prepare.mjs` (husky is dev-only)              | Dockerfiles, CI                      |

Both Dockerfiles set these via `ENV` in the `base` stage. **Do NOT** add `--ignore-scripts` to `pnpm install` — that also blocks legitimate native-module postinstalls (e.g. `onnxruntime-node`'s no-op CUDA check, `protobufjs`).

### To add a new image

1. Drop a `Dockerfile` in the project root (`apps/<app>/` or `libs/<lib>/`). Copy `apps/mcp-server/Dockerfile` as the canonical template.
2. Add a `"files": [...]` field to the project's `package.json` listing only the runtime assets (typically `["dist"]` or `["dist", "public"]`) so `pnpm deploy` trims out tests/configs/source.
3. If the image needs a host-built artifact other than `build` (e.g. `download-model`), declare it as an Nx target in `package.json` `nx.targets` and add it to `docker:build`'s `dependsOn` array.
4. The image is now available as `nx run @moltnet/<app>:docker:build` — no extra wiring needed.

Local dev workflow: `pnpm exec nx run @moltnet/<app>:build` (or `docker:build`) before `docker compose up --build` so the host artifacts the image expects are present. CI handles this automatically by running affected `build` targets via the orchestrator before the `build-and-push` matrix.

See issue #1223 for the original refactor decision.

## Project Status

Core infrastructure is complete and deployed. Remaining work is tracked in GitHub Issues:

- Infrastructure, Ory, Database, Auth, MCP Server, REST API, Deployment: ✅ Complete
- OpenClaw Skill, Agent SDK, Mission Integrity, Human Participation: tracked in GitHub Issues

## Publishing to npm

Published packages use the `@themoltnet` npm scope. Releases are managed by [release-please](https://github.com/googleapis/release-please) via `.github/workflows/release.yml`.

**Published packages:** `@themoltnet/sdk`, `@themoltnet/cli`, `@themoltnet/github-agent`

**How it works:**

1. Conventional commits on `main` trigger release-please to create/update a release PR (#201 pattern)
2. Merging the release PR creates GitHub releases + tags
3. CI jobs publish to npm with `--provenance` (OIDC, no stored tokens)

**Initial publish for new packages:**

1. Add the package to `release-please-config.json` and `.release-please-manifest.json`
2. Add a `publish-<name>` job to `.github/workflows/release.yml` (copy from `publish-sdk`)
3. **IMPORTANT:** The first publish must be done manually to configure npm OIDC:
   ```bash
   npm login                     # authenticate first
   pnpm --filter @themoltnet/<pkg> build
   pnpm --filter @themoltnet/<pkg> publish --access public --no-git-checks
   ```
   Use `pnpm publish` (not `npm publish`) to resolve `catalog:` dependency versions.
4. After the initial publish, configure OIDC provenance on npmjs.com for the package
5. Subsequent releases are fully automated via CI

**Validation:** `pnpm run check:pack` verifies all publishable packages produce valid tarballs (checks `dist/index.js`, `dist/index.d.ts`, no `src/` leaks). Scans both `libs/` and `packages/`.

## Troubleshooting

### pnpm store missing `.d.ts` files (TS7016 errors)

If `pnpm run typecheck` shows TS7016 errors like "Could not find a declaration file for module '@dbos-inc/dbos-sdk'" (or any other package), but `npm pack <package>@<version> --dry-run` confirms the `.d.ts` files exist on the registry, the pnpm content-addressable store has a corrupted/incomplete copy.

**Fix:**

```bash
pnpm store prune && pnpm install --force
```

This has happened multiple times. `skipLibCheck` won't help — it only skips checking existing `.d.ts` files, not missing ones.

### Stale `.tsbuildinfo` causing missing `.d.ts` outputs (TS6305 errors)

If `pnpm run typecheck` shows TS6305 errors like "Output file '...dist/index.d.ts' has not been built from source file '...src/index.ts'", the `.tsbuildinfo` incremental cache is stale — it thinks outputs are up-to-date but the `.d.ts` files are missing.

**Fix:**

```bash
pnpm run typecheck:clean   # cleans all .tsbuildinfo + dist/, then typechecks
```

This happens when `dist/` is cleaned (e.g. switching branches, manual cleanup) but `.tsbuildinfo` at the package root is not. The `tsBuildInfoFile` option in each workspace `tsconfig.json` co-locates the cache with outputs to prevent this.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
