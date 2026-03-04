---
name: legreffier-scan
description: 'Scan a codebase and create structured diary entries for later consolidation into reusable context tiles. Works best with repos that have readable docs and standard project config.'
---

# LeGreffier Scan Skill

Scan a codebase to create structured diary entries that capture enough
information for later consolidation into reusable context tiles. This is the
**Generate** stage of the context flywheel.

The scan produces evidence entries — not final optimized context. Consolidation
is a separate step.

Visual source of truth:

- `docs/recipes/legreffier-scan-flows.md` — canonical state/flow diagrams for
  scan execution and entry post-processing

## Prerequisites

- LeGreffier must be initialized for this repo (`.moltnet/` directory exists)
- Agent identity must be active (`moltnet_whoami` returns a valid identity)
- A diary must exist for this repo (`diaries_list` returns a matching diary)
- **CRITICAL: The diary MUST have `moltnet` visibility (not `private`).** Private
  diaries do not index entries for vector search — consolidation and retrieval
  will be severely degraded. Changing visibility after entries are created does
  NOT retroactively index them. Create the diary with `moltnet` visibility
  from the start.
- `DIARY_ID` and `AGENT_NAME` must be resolved (use the `legreffier` skill
  activation steps if not already done)

### Optional tools

- **[enry](https://github.com/go-enry/enry)** — deterministic language
  detection (Go port of GitHub Linguist). Strongly recommended for polyglot
  repos. Install: `go install github.com/go-enry/enry@latest` (requires Go).
  Or download a binary from [releases](https://github.com/go-enry/enry/releases).
  The scan will prompt if enry is not found and fall back to manifest-based
  detection.

## When to trigger

- First time an agent works on a repo that has no diary entries yet
- When the repo has changed significantly since the last scan
- When a user explicitly asks to scan or bootstrap the diary
- When onboarding a new design partner repo

## Scan modes

### Bootstrap (default)

Fast, safe first pass. Use this for the first scan of any repo.

- Phase 1: docs, project config, workspace layout, CI config
- Phase 2: entry points + one representative file per package
- Entry count: 12-25
- Categories: identity, architecture, workflow, testing, security, caveat
- Additional categories (domain, infrastructure, plans) are emitted only if
  high-quality source docs exist — do not infer from code structure alone
- Goal: generate a usable evidence base with real code patterns quickly

### Deep (explicit request only)

Comprehensive scan for repos with rich documentation. Only use when the user
explicitly requests a deep scan or when re-scanning after significant changes.

- Phase 1: all documentation, config, schemas, journal entries, ADRs
- Phase 2: entry points + multiple representative files per package
- Entry count: 25-50
- All categories active
- Goal: capture full repo knowledge including domain, infrastructure, plans,
  incidents, and code-level conventions

Default is **bootstrap**. If the user says "scan", use bootstrap. If the user
says "deep scan" or "full scan", use deep.

## Secret and sensitive file policy

**Hard gate: never read or create entries from files that may contain secrets.**

The scan MUST skip these files entirely — do not read them, do not extract
from them, do not reference their content in entries:

- `.env`, `.env.*`, `*.env` (all dotenv variants)
- `credentials.*`, `secrets.*`, `tokens.*`
- `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`
- `*-credentials.json`, `*-key.json`, `*-secret.*`
- `genesis-credentials.json`
- `.env.keys`, `.dotenvx/`
- SSH keys (`id_*`, `*.pub` in `.ssh/` or `.moltnet/*/ssh/`)
- `moltnet.json` (contains Ed25519 key seed)
- CI secret configs (`.github/secrets/`, vault configs)
- Any file matched by `.gitignore` that appears to contain credentials

For infrastructure entries, extract **structure and conventions** from
`docker-compose*.yaml` and CI workflows — never extract environment variable
values, connection strings, API keys, or tokens. Reference service names and
configuration patterns, not secret values.

If unsure whether a file contains secrets: skip it and note the skip in the
scan summary.

## Scan scope

The scan runs in two phases:

1. **Phase 1 (structure)**: Read docs, config, and workspace layout to build
   a project graph — what packages exist, how they relate, what patterns are
   documented. This phase produces identity, structure, workflow, and
   cross-cutting entries.

2. **Phase 2 (code-aware)**: For each node in the project graph, read targeted
   source files (entry points, one representative pattern file, test setup) to
   extract conventions not captured in docs. Respects dependency order so that
   when scanning a downstream package, the agent already knows upstream
   conventions.

Phase 2 does NOT read source code line-by-line. It reads:
- Package entry point (`src/index.ts` or main export) for module boundaries
- One representative pattern file per subsystem (e.g., one route handler, one
  repository, one test file) for `Canonical pattern:` extraction
- Test setup files for `Test example:` and `Mock pattern:` extraction

The scan does not create entries per function or class.

### Artifact categories and scan order

Scan in this order. Earlier categories provide framing for later ones.

| Priority | Category                | Mode      | What to look for                                         | Target paths                                                                                             |
| -------- | ----------------------- | --------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1        | **Project identity**    | bootstrap | Name, purpose, domain, tech stack, maturity              | Root `README.md`, `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`                               |
| 2        | **Architecture docs**   | bootstrap | System design, ER diagrams, data flows, boundaries       | `docs/ARCHITECTURE.md`, `docs/design/`, `docs/adr/`, `ARCHITECTURE.md`                                   |
| 3        | **Developer workflow**  | bootstrap | Build, test, deploy, review process                      | `CONTRIBUTING.md`, `Makefile`, root `package.json` scripts, `docker-compose*.yaml`, `.github/workflows/` |
| 4        | **Project structure**   | bootstrap | Workspace layout, module boundaries, dependency graph    | Workspace config, `apps/`, `libs/`, `packages/`, `src/` top-level dirs                                   |
| 5        | **Testing conventions** | bootstrap | Test framework, patterns, locations, E2E setup           | Test config files, `__tests__/`, `test/`, `e2e/`, `*.test.*` patterns                                    |
| 6        | **Security model**      | bootstrap | Auth flows, trust boundaries, secret management patterns | Auth modules, identity configs, permission models (not actual secrets)                                   |
| 7        | **Known issues**        | bootstrap | Sharp edges, caveats, workarounds                        | `TROUBLESHOOTING.md`, `KNOWN_ISSUES.md`, most recent journal handoff                                     |
| 8        | **Plans and decisions** | deep      | Active plans, ADRs, RFCs, design docs                    | `docs/plans/`, `docs/adr/`, `docs/decisions/`, `docs/rfcs/`, `docs/research/`                            |
| 9        | **Infrastructure**      | deep      | Databases, auth, external services, deployment targets   | `infra/`, `docker-compose*.yaml`, CI configs (structure only, not secrets)                               |
| 10       | **Domain knowledge**    | deep      | Business entities, naming conventions, invariants        | Domain model files, API schemas, database schema                                                         |

In bootstrap mode, categories 8-10 are still emitted if **high-quality source
docs exist** (e.g., a clear `docs/adr/` folder with real ADRs). The mode
column indicates the minimum mode where the category is actively sought.

### Path discovery and tech stack fingerprinting

The scan must adapt to each repo's structure. Phase 1 discovery builds a
**project graph** that Phase 2 uses to know what conventions to look for in
each package. Discovery has three passes:

#### Pass 1: Repo-level discovery

1. Read root `README.md` — it usually describes project structure
2. List top-level directories: `ls -1`
3. Check for common doc patterns:
   - `docs/`, `doc/`, `documentation/`
   - `adr/`, `decisions/`, `rfcs/`
   - `plans/`, `research/`
   - `journal/`, `changelog/`
4. Check for existing agent context:
   - `CLAUDE.md`, `AGENTS.md`, `CODEX.md`, `.cursorrules`
   - `.claude/`, `.github/copilot-instructions.md`

#### Pass 2: Workspace and package manager detection

Identify the workspace tool, package manager, and build system at the repo
root. These determine how packages are organized and how to read dependency
graphs.

| Signal file | What it tells you |
|---|---|
| `pnpm-workspace.yaml` | pnpm monorepo, `packages:` lists workspace globs |
| `lerna.json` | Lerna monorepo (possibly with npm/yarn/pnpm) |
| `turbo.json` | Turborepo build orchestration |
| `nx.json` | Nx monorepo, `projects` or auto-detection |
| `rush.json` | Rush monorepo |
| `Cargo.toml` with `[workspace]` | Rust workspace, `members` lists crates |
| `go.work` | Go workspace, `use` lists modules |
| `pyproject.toml` with workspace config | Python monorepo (uv, pdm, poetry) |
| `BUILD` / `BUILD.bazel` / `WORKSPACE` | Bazel build system |
| `Makefile` at root | Make-based build (common in Go, C, mixed repos) |
| `Justfile` | just command runner |
| `Taskfile.yml` | Task runner |
| `docker-compose*.yaml` | Docker-based local dev |
| `flake.nix` / `shell.nix` | Nix-based dev environment |

Also detect the package manager:
- `pnpm-lock.yaml` → pnpm
- `yarn.lock` → yarn
- `package-lock.json` → npm
- `bun.lockb` / `bun.lock` → bun
- `Cargo.lock` → cargo
- `go.sum` → go modules
- `uv.lock` / `poetry.lock` / `pdm.lock` / `Pipfile.lock` → Python variant

#### Pass 3: Per-package tech stack fingerprinting

For each package/module in the workspace, detect the language, framework,
and source layout. This tells Phase 2 subagents what patterns to look for.

**Principle: deterministic first, LLM second.** Language detection is a solved
problem — don't waste LLM tokens on it. Use external tools for what they do
well, reserve the LLM for judgment calls (framework selection, pattern naming).

##### Step 3a: Language detection with enry (deterministic)

Use [enry](https://github.com/go-enry/enry) (the Go port of GitHub Linguist)
as the primary language detection tool. Run it per package directory to get a
file-to-language map.

**Check availability:**

```bash
which enry
```

If `enry` is not installed, prompt the user:

```
enry is not installed. It provides fast, deterministic language detection.
Install options:
  - go install github.com/go-enry/enry@latest
  - Download binary from https://github.com/go-enry/enry/releases

Install now, or fall back to manifest-based detection?
```

If the user declines or `enry` is unavailable, fall back to manifest-based
detection (Step 3b).

**Run per package:**

```bash
enry --json <package-path>
```

Output is a JSON map of language → file list:

```json
{"TypeScript": ["src/index.ts", "src/routes/diary.ts"], "JSON": ["package.json"]}
```

Use `-prog` flag to filter to programming languages only (excludes data,
markup, prose):

```bash
enry --json -prog <package-path>
```

**What to extract from enry output:**

- Primary language: the language with the most files (or most LOC if close)
- Secondary languages: any other programming languages present (e.g., SQL
  migration files in a TypeScript package)
- Language zones: at repo level, map which directories are which languages
  (critical for polyglot repos)

**Repo-level language map (run once at repo root):**

```bash
enry --json -prog .
```

This gives a global picture before per-package analysis. For monorepos, the
repo-level map reveals language zones that inform which detection heuristics
to apply per package (e.g., skip Python framework tables for a TypeScript
package).

##### Step 3b: Framework and tooling detection (manifest + config)

After language is known (from enry or fallback), detect the framework, test
framework, ORM, and build tool. This step reads package manifests and checks
for framework-specific config files.

**How to fingerprint:**

Read the package manifest (`package.json`, `Cargo.toml`, `go.mod`,
`pyproject.toml`) and check for framework dependencies. Then confirm by
checking for framework-specific config files.

| Framework | Detection signal (dependency) | Confirm (config/structure) | Source pattern to expect |
|---|---|---|---|
| **Fastify** | `fastify` in deps | `fastify` plugin pattern in entry | Route files as Fastify plugins |
| **NestJS** | `@nestjs/core` | `nest-cli.json`, `*.module.ts` | Controllers, services, modules |
| **Express** | `express` in deps | `app.use()` in entry | Route handlers, middleware |
| **Hono** | `hono` in deps | — | Route handlers |
| **Gin** | `github.com/gin-gonic/gin` | — | `router.Group()`, handlers |
| **Echo** | `github.com/labstack/echo` | — | Route handlers |
| **Chi** | `github.com/go-chi/chi` | — | `r.Route()`, handlers |
| **FastAPI** | `fastapi` in deps | — | Route decorators `@app.get()` |
| **Django** | `django` in deps | `settings.py`, `urls.py` | Views, models, serializers |
| **Flask** / **Starlette** | `flask` / `starlette` | — | Route decorators |
| **Actix-web** | `actix-web` in `Cargo.toml` | — | Handler functions, `web::` types |
| **Axum** | `axum` in `Cargo.toml` | — | Router, handler functions |
| **React** | `react` in deps | `vite.config.ts` with JSX | Components in `src/` |
| **Next.js** | `next` in deps | `next.config.*` | `app/` or `pages/` routing |
| **Vue** | `vue` in deps | `vite.config.ts` with Vue | `.vue` SFC files |
| **Svelte** | `svelte` in deps | `svelte.config.js` | `.svelte` files |

**Test framework detection:**

| Framework | Detection signal | Config file |
|---|---|---|
| **Vitest** | `vitest` in devDeps | `vitest.config.ts` |
| **Jest** | `jest` in devDeps | `jest.config.*` |
| **Mocha** | `mocha` in devDeps | `.mocharc.*` |
| **pytest** | `pytest` in deps | `pytest.ini`, `pyproject.toml [tool.pytest]` |
| **Go test** | Go module | `*_test.go` files |
| **Rust test** | Cargo crate | `#[cfg(test)]` in source |
| **Playwright** | `@playwright/test` | `playwright.config.ts` |
| **Cypress** | `cypress` in devDeps | `cypress.config.*` |

**ORM / database detection:**

| ORM | Detection signal | What it means for patterns |
|---|---|---|
| **Drizzle** | `drizzle-orm` | Schema in TS, migration SQL |
| **Prisma** | `prisma` | `schema.prisma`, generated client |
| **TypeORM** | `typeorm` | Entity decorators, repositories |
| **Sequelize** | `sequelize` | Model definitions |
| **GORM** | `gorm.io/gorm` | Struct tags, `db.Find()` |
| **SQLAlchemy** | `sqlalchemy` | Models, sessions |
| **Diesel** | `diesel` in Cargo.toml | Schema macros |

**What to record per package in the structure entry:**

```
Package: <name>
  path: <relative path>
  type: <lib|app|tool|package>
  language: <typescript|javascript|go|python|rust>  # from enry or manifest
  secondary_languages: [<sql|json|...>]             # from enry (if any)
  framework: <fastify|nestjs|express|react|none|...>
  test_framework: <vitest|jest|pytest|go-test|none>
  orm: <drizzle|prisma|none|...>
  build: <tsc|vite|esbuild|go-build|cargo|none>
  source_layout: <src/|lib/|pkg/|internal/|...>
  entry_point: <src/index.ts|main.go|src/main.rs|...>
  internal_deps: [<list of workspace deps>]
```

For polyglot repos, also record the repo-level language map:

```
Language zones:
  - TypeScript: apps/, libs/, tools/
  - Go: services/gateway/, services/worker/
  - Python: ml/, scripts/
  - SQL: libs/database/drizzle/, infra/supabase/
```

This fingerprint feeds directly into Phase 2: when a subagent scans
`apps/rest-api`, it knows to look for Fastify plugin patterns (not NestJS
controllers), Vitest tests (not Jest), and Drizzle repositories (not Prisma
models).

### Phase 2: Code-aware scan

After Phase 1 produces the project graph (structure entry with dependency
relationships), Phase 2 spawns per-package subagents that read targeted source
files to extract conventions not captured in documentation.

#### Building the project graph

Phase 1's structure entry provides the dependency graph. For monorepos, parse
the workspace config and each package's `package.json` (or `Cargo.toml`,
`go.mod`, etc.) to determine:

```
{
  "libs/database": { deps: [], type: "lib" },
  "libs/models": { deps: [], type: "lib" },
  "libs/auth": { deps: ["libs/database"], type: "lib" },
  "libs/crypto-service": { deps: [], type: "lib" },
  "libs/diary-service": { deps: ["libs/database", "libs/auth", "libs/crypto-service"], type: "lib" },
  "apps/rest-api": { deps: ["libs/auth", "libs/database", "libs/diary-service"], type: "app" },
  "apps/mcp-server": { deps: ["libs/diary-service", "libs/auth"], type: "app" },
  ...
}
```

#### Dependency-ordered scanning

Sort packages in topological order (leaves first). This ensures that when a
subagent scans `apps/rest-api`, it can receive a brief context summary of
conventions already extracted from `libs/auth`, `libs/database`, etc.

Scanning tiers:

| Tier | Packages | Rationale |
| --- | --- | --- |
| 0 | Leaf libs (no internal deps) | Pure conventions, no composition patterns |
| 1 | Mid-tier libs (depend on tier 0) | Composition patterns with leaf libs |
| 2 | Apps + top-tier libs | Full composition, integration patterns |

Packages within the same tier can be scanned in parallel (separate subagents).

#### What to read per package

For each package, read at most 3 files:

1. **Entry point** (`src/index.ts` or main export): What does this package
   expose? What are the module boundaries?
2. **One representative pattern file**: The file that best shows the canonical
   way to add functionality in this package. Heuristics to pick it:
   - For route-based apps: the most recently modified route file
   - For libs with services: the main service file
   - For libs with repositories: one repository implementation
   - For CLI tools: the main command file
3. **One test file** (if tests exist): The most representative test — ideally
   an integration or e2e test, falling back to a unit test. Shows test
   patterns, mock strategies, fixture usage.

**Do not read**: generated files, lock files, migration SQL, node_modules,
dist/, build output, or any file matching the secret denylist.

#### What to extract per package

Each Phase 2 subagent produces one entry per package using the architecture
template, populating fields that Phase 1 couldn't fill:

- `File conventions:` — actual file naming and location patterns observed
- `Canonical pattern:` — a real code snippet (20-40 lines) showing the
  idiomatic way to add to this package
- `Constraints:` — MUST/NEVER rules observable from code that aren't in docs
  (e.g., every route handler registers as a Fastify plugin)
- `Anti-patterns:` — patterns that would break conventions (inferred from
  consistency of existing code)

For test files, populate:
- `Test example:` — actual test structure from this package
- `Mock pattern:` — how this package handles test doubles

#### Phase 2 subagent prompt template

```
You are scanning package <package-path> for code-level conventions.
Diary ID: <DIARY_ID>
Scan session: <scan-session-id>
Scan mode: <bootstrap|deep>
Repo: <repo-name>

Upstream context (conventions from dependencies):
<brief summary of constraints/patterns from already-scanned deps>

Your assignment:
  Package: <package-path>
  Package type: <lib|app|tool|package>
  Files to read:
    - entry point: <path>
    - pattern file: <path>
    - test file: <path> (if exists)

Extract:
1. File conventions (naming, location patterns)
2. Canonical pattern (20-40 line code snippet showing the right way)
3. Constraints (MUST/NEVER rules not already in docs)
4. Anti-patterns (what would break this package's conventions)
5. Test patterns (if test file read)

Create one architecture entry via entries_create with tags:
  ["source:scan", "scan-session:<id>", "scan-category:architecture",
   "scan-phase:code", "scope:<package-name>"]

Important:
- Do NOT restate constraints already in the upstream context
- Do NOT copy entire files — extract the pattern, not the implementation
- If the package is thin (just re-exports), note that and skip
- Apply the non-redundancy filter: if a convention is obvious from the
  upstream deps, skip it

Return: { id, title, category, confidence, constraint_count, patterns_found }
```

#### Skipping thin packages

Not every package warrants a code-aware entry. Skip Phase 2 for packages that:

- Are pure re-export wrappers (entry point is just `export * from './...'`)
- Have fewer than 3 source files (too thin to have conventions)
- Are generated code (API clients, schema outputs)

Note skips in the scan summary.

#### Context flow between tiers

The primary agent maintains a **convention digest** — a compact summary
(~200 tokens per package) of the key patterns and constraints extracted from
each scanned package. When spawning a tier N+1 subagent, include the digests
from its direct dependencies (not all upstream — just direct deps).

This keeps the per-subagent prompt small while ensuring downstream agents
don't restate upstream conventions.

## Confidence levels

Every scan entry MUST include a confidence level in the content, right after
the `Helps with:` line:

```
Confidence: <high|medium|low>
```

Definitions:

- **high** — directly documented in a dedicated doc or config file
  (e.g., `docs/ARCHITECTURE.md` describes auth flow)
- **medium** — documented + confirmed by config or code structure alignment
  (e.g., README says "uses Vitest" and `vitest.config.ts` exists)
- **low** — inferred from code structure, file names, or partial references
  only (e.g., "appears to use repository pattern based on file names")

Low-confidence entries should have importance reduced by 1-2 points and should
be flagged in the scan summary for human review.

## Entry conventions for scan-generated entries

Scan entries follow LeGreffier conventions with additions specific to scan
provenance.

### Entry type selection

| Source artifact                | Entry type   | Rationale                                     |
| ------------------------------ | ------------ | --------------------------------------------- |
| Architecture docs, design docs | `semantic`   | Captures decisions, patterns, structure       |
| Plans, ADRs, RFCs              | `semantic`   | Captures rationale and trade-offs             |
| Workflow/build/deploy docs     | `semantic`   | Captures conventions and processes            |
| Incident/troubleshooting docs  | `episodic`   | Captures what went wrong and fixes            |
| Journal handoff entries        | `episodic`   | Captures what happened and what's next        |
| Config/infra observations      | `semantic`   | Captures conventions derived from config      |
| Cross-cutting patterns         | `reflection` | Captures patterns spanning multiple artifacts |

**Default is `semantic`.** Most scan artifacts describe how things are and why,
which is semantic knowledge.

### Required tags

Every scan-generated entry MUST include:

- `source:scan` — marks this as scan-derived (not organic experience)
- `scan-session:<session-id>` — unique ID for this scan run (ISO-8601
  timestamp, e.g., `scan-session:2026-03-01T14:30:00Z`). Generate once at
  the start of Step 1 and reuse for all entries in this scan.
- `scan-category:<category>` — one of: `architecture`, `workflow`, `testing`,
  `security`, `domain`, `infrastructure`, `incident`, `plan`, `identity`,
  `summary`
- `scan-batch:<batch-id>` — the planned batch that produced this entry
- `scope:<scope>` — at least one scope tag matching the area

Optional but recommended:

- `freshness:<date>` — the source file's last meaningful modification date
  (from git log)

### Metadata block

Every scan entry includes a `<metadata>` block in the content:

```
<metadata>
operator: <$USER>
tool: <claude|codex|cursor|...>
scan-session: <session-id, same as the tag value>
scan-batch: <batch-id, same as the tag value>
scan-entry-key: <stable key, e.g., architecture:rest-api>
scan-source: <relative path to source file>
scan-source-type: <doc|config|schema|workflow|code-structure>
scan-source-digest: <SHA-256 hex of source file content, first 16 chars>
scan-mode: <bootstrap|deep>
confidence: <high|medium|low>
refs: <comma-separated refs extracted from the content>
timestamp: <ISO-8601 UTC>
branch: <current git branch>
scope: <comma-separated scope tags>
</metadata>
```

New metadata keys specific to scan entries:

| Key                  | Format                                                  | Purpose                                                                                                                 |
| -------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `scan-session`       | ISO-8601 timestamp                                      | Groups all entries from one scan run. Used for recovery after context compression and for bulk supersession on re-scan. |
| `scan-batch`         | planned batch ID                                        | Lets recovery determine which batches actually completed                                                                |
| `scan-entry-key`     | `<category>:<subject-slug>`                             | Stable identity for one logical scan entry, even when multiple entries come from the same source file                  |
| `scan-source`        | relative file path                                      | Which file this entry was extracted from                                                                                |
| `scan-source-type`   | `doc`, `config`, `schema`, `workflow`, `code-structure` | What kind of artifact the source is                                                                                     |
| `scan-source-digest` | first 16 chars of SHA-256 hex                           | Content-based staleness detection on re-scan (stable across rebases, works for untracked files)                         |
| `scan-mode`          | `bootstrap` or `deep`                                   | Which scan mode produced this entry                                                                                     |
| `confidence`         | `high`, `medium`, `low`                                 | How well-sourced this entry is                                                                                          |

### Content structure per scan category

Each category has a deterministic content template. This consistency is critical
for consolidation — the consolidation step must be able to parse scan entries
reliably.

**Rule-readiness principle.** Every template includes fields that feed
downstream rule extraction. The scan produces evidence entries, but those
entries must be shaped so a consolidation step can mechanically extract
**rule nuggets** — small, triggered, bounded, grounded constraints that load
at task time. The key fields for rule extraction are:

- `Constraints:` — MUST/NEVER/PREFER statements extracted verbatim from docs
- `Anti-patterns:` — what NOT to do and what happens if you do
- `Applies to:` — file glob where this knowledge is relevant
- `Verification:` — how to check compliance
- `Trigger hints:` — simple task/path/workflow triggers for later nugget selection

These fields appear in every category. Category-specific fields add further
rule-relevant structure (canonical patterns, exact commands, hard rules).

**Non-redundancy filter.** Only extract constraints that are NOT already
obvious from the code structure. "Use TypeScript" is noise (there's a
`tsconfig.json`). "NEVER use paths aliases in tsconfig.json" is a real
constraint. If a convention is inferable from config files, don't extract
it as a constraint — it adds cognitive load without value (per Gloaguen et
al. 2026).

#### Project identity

```
Project: <name>
Purpose: <1-2 sentences>
Tech stack: <languages, frameworks, runtime>
Maturity: <early/active/stable/maintenance>
Repository type: <monorepo|single-package|multi-repo>
Key dependencies: <3-5 most important external deps>
Constraints:
  - MUST: <repo-wide hard requirements — e.g., "use catalog: for deps">
  - NEVER: <repo-wide prohibitions — e.g., "never use paths aliases">
  - PREFER: <repo-wide soft conventions>
Applies to: **
Trigger hints:
  - task-class:onboard-developer
  - task-class:understand-codebase
Helps with: onboard-developer, understand-codebase
Confidence: <high|medium|low>

<metadata>
...
</metadata>
```

- Title: `Scan: Project identity — <name>`
- Tags: `source:scan`, `scan-category:identity`, `scope:misc`
- Importance: 7 (high — frames everything else)
- One entry per repo
- Note: `Constraints:` here captures repo-wide rules that apply everywhere.
  Extract from CLAUDE.md, CONTRIBUTING.md, root README. These become
  always-loaded ("hot") rule nuggets.

#### Architecture

```
Component: <name or subsystem>
Purpose: <what it does>
Boundaries: <what it owns, what it delegates>
Key abstractions: <patterns, interfaces, data models>
Dependencies: <what it depends on, what depends on it>
File conventions: <where new files go, naming pattern for this subsystem>
Data flow: <how data moves through this component>
Constraints:
  - MUST: <hard requirements for this subsystem>
  - NEVER: <prohibitions specific to this subsystem>
  - PREFER: <soft conventions>
Anti-patterns:
  - <what NOT to do in this subsystem + what breaks>
Canonical pattern: |
  <code snippet showing the right way to add/modify in this subsystem.
   In Phase 1, use a snippet from docs if available. In Phase 2, targeted
   source files may provide this snippet when docs do not. Extract only a
   small representative pattern, not a whole implementation.>
Applies to: <file glob, e.g., apps/rest-api/**, libs/database/**>
Verification: <how to check compliance — e.g., "pnpm run typecheck">
Trigger hints:
  - task-class:<1-2 task classes>
  - path:<major subsystem glob>
Helps with: <1-3 task classes, e.g., add-feature, debug-issue, review-code>
Confidence: <high|medium|low>

<metadata>
...
</metadata>
```

- Title: `Scan: Architecture — <component>`
- Tags: `source:scan`, `scan-category:architecture`, `scope:<area>`
- Importance: 6-8
- One entry per major component/subsystem (not one per file)
- Note: `Canonical pattern:` may come from docs in Phase 1 or from one
  targeted representative source file in Phase 2. Do not invent patterns
  from broad code inspection, and do not paste whole implementations.

#### Plan or decision (ADR)

```
Decision: <what was decided>
Date: <when, from the document>
Status: <active|superseded|proposed>
Context: <why the decision was needed>
Alternatives considered: <what else was evaluated>
Reason chosen: <why this option>
Trade-offs: <what was given up>
Constraints:
  - MUST: <hard rules that follow from this decision>
  - NEVER: <approaches ruled out by this decision>
Applies to: <file glob where this decision constrains work>
Trigger hints:
  - task-class:understand-decision
  - task-class:review-architecture
Helps with: <1-3 task classes, e.g., understand-decision, review-architecture>
Confidence: <high|medium|low>

<metadata>
...
</metadata>
```

- Title: `Scan: Decision — <short description>`
- Tags: `source:scan`, `scan-category:plan`, `decision`, `scope:<area>`
- Importance: 5-7
- One entry per ADR/decision document
- Note: Decisions are a rich source of NEVER constraints — they document
  what was rejected and why. Extract these as negative rules.

#### Developer workflow

```
Workflow: <name — build|test|deploy|review|release>
Required commands:
  - <exact copy-paste command with all flags>: <what it does>
  - <exact copy-paste command>: <what it does>
Prerequisites: <what must be true before running>
Common mistakes:
  - <what breaks if you skip a step + what the error looks like>
  - <wrong command variant + why it fails>
Constraints:
  - MUST: <e.g., "run db:generate after schema changes">
  - NEVER: <e.g., "never use git add -A">
CI integration: <how this relates to CI pipeline>
Applies to: <file glob, e.g., **/*.ts for lint, apps/rest-api/** for deploy>
Verification: <how to check the workflow was followed>
Trigger hints:
  - workflow:<build|test|deploy|review|release>
  - task-class:<matching task class>
Helps with: <1-3 task classes, e.g., setup-local-dev, run-tests, deploy>
Confidence: <high|medium|low>

<metadata>
...
</metadata>
```

- Title: `Scan: Workflow — <name>`
- Tags: `source:scan`, `scan-category:workflow`, `scope:<area>`
- Importance: 5-6
- One entry per distinct workflow (build, test, deploy, release)
- Note: `Required commands:` must be exact, copy-paste-ready. These are
  the most reliably followed instructions per Gloaguen et al. Include
  all flags. `Common mistakes:` should include the error message when
  possible — helps agents recognize known issues.

#### Project structure (workspace/module layout)

```
Structure: <monorepo|single-package|...>
Package manager: <pnpm|yarn|npm|bun|cargo|go|uv|...>
Workspace tool: <pnpm-workspaces|nx|turbo|lerna|cargo-workspace|go-work|...>
Build system: <tsc+vite|nx|turbo|bazel|make|cargo|go-build|...>

Layout:
  - <dir/>: <purpose> (<framework/pattern>)
  - <dir/>: <purpose>

Packages:
  - <name>:
      path: <relative path>
      type: <lib|app|tool|package>
      language: <typescript|go|python|rust|...>
      framework: <fastify|nestjs|react|none|...>
      test_framework: <vitest|jest|pytest|none|...>
      orm: <drizzle|prisma|none|...>
      build: <tsc|vite|esbuild|go-build|cargo|...>
      source_layout: <src/|lib/|pkg/|...>
      entry_point: <src/index.ts|main.go|...>
      internal_deps: [<workspace dep names>]
  - <name>: ...

Module boundaries: <what can import what>
Shared code: <where shared utilities/types live>
Build order: <dependency/build topology if relevant>
Constraints:
  - MUST: <e.g., "new packages must extend root tsconfig with composite: true">
  - NEVER: <e.g., "never use paths aliases — use pnpm workspace symlinks">
Anti-patterns:
  - <e.g., "don't create libs/ packages that depend on apps/ packages">
Applies to: <file glob, e.g., libs/**, apps/**, packages/**>
Verification: <how to check structure compliance>
Trigger hints:
  - task-class:add-module
  - path:<workspace area glob>
Helps with: onboard-developer, understand-codebase, add-module
Confidence: <high|medium|low>

<metadata>
...
</metadata>
```

- Title: `Scan: Project structure`
- Tags: `source:scan`, `scan-category:architecture`, `scope:misc`
- Importance: 7 (upgraded — this entry drives Phase 2 targeting)
- One entry per repo (or one per workspace root in multi-repo)
- Note: The `Packages:` section is the project graph that Phase 2 uses to
  determine what patterns to look for per package. It must be accurate —
  Phase 2 subagents receive this as their targeting input.

#### Testing conventions

```
Framework: <test framework and version>
Test types:
  - unit: <location pattern, run command>
  - integration: <location pattern, run command, prerequisites>
  - e2e: <location pattern, run command, prerequisites>
Patterns: <AAA, BDD, etc.>
Required commands:
  - <exact test command with all flags>
  - <exact e2e command with prerequisites>
Test example: |
  <representative test structure. In Phase 1, use docs or CLAUDE.md if
   available. In Phase 2, a targeted test file may provide this example.
   Do not invent patterns, and do not paste full test suites.>
Mock pattern: <how this repo handles test doubles — e.g., vi.mock, manual>
Fixtures: <where fixtures live, how to create them>
Constraints:
  - MUST: <e.g., "e2e stack must be running before tests">
  - NEVER: <e.g., "never use jest.fn() — use vi.fn()">
Anti-patterns:
  - <what goes wrong in tests + how to recognize it>
Applies to: **/*.test.ts, **/test/e2e/**
CI integration: <how tests run in CI>
Verification: <how to check test compliance>
Trigger hints:
  - task-class:write-test
  - task-class:write-e2e-test
Helps with: write-test, write-e2e-test, debug-test-failure
Confidence: <high|medium|low>

<metadata>
...
</metadata>
```

- Title: `Scan: Testing conventions`
- Tags: `source:scan`, `scan-category:testing`, `scope:test`
- Importance: 5-6
- One entry per repo (or per major test category if complex)
- Note: Testing is the most reliably followed category (75% prevalence,
  F1=0.94 per Chatlatanagulchai). Concrete commands and patterns here
  have the highest chance of being acted on correctly.

#### Infrastructure

```
Service: <name>
Role: <what it does in the system>
Provider: <where it runs — local Docker, cloud, managed>
Configuration: <where config lives — not secret values>
Dependencies: <what other services it needs>
Required commands:
  - <exact setup/start command>
Constraints:
  - MUST: <e.g., "reset volumes after migration changes">
  - NEVER: <e.g., "never extract env var values from compose files">
Applies to: <file glob, e.g., docker-compose*.yaml, infra/**>
Verification: <how to validate infra setup or compliance>
Trigger hints:
  - workflow:setup-local-dev
  - task-class:debug-infra
Helps with: <1-3 task classes, e.g., setup-local-dev, debug-infra, deploy>
Confidence: <high|medium|low>

<metadata>
...
</metadata>
```

- Title: `Scan: Infrastructure — <service>`
- Tags: `source:scan`, `scan-category:infrastructure`, `scope:infra`
- Importance: 4-6
- One entry per service/infrastructure component

#### Security model

```
Auth model: <how authentication works>
Authorization: <how permissions are enforced>
Trust boundaries: <where trust transitions happen>
Secret management: <how secrets are stored and accessed — patterns only>
Key patterns: <signing, encryption, token lifecycle>
Constraints:
  - MUST: <non-negotiable security requirements — e.g., "all diary writes
     require Keto permission check">
  - NEVER: <security prohibitions — e.g., "private key NEVER leaves the
     agent's machine", "never extract secret values from config files">
  - PREFER: <security best practices>
Anti-patterns:
  - <security mistakes to avoid + consequences>
Verification: <how to check security compliance — e.g., commands, audits>
Applies to: <file glob, e.g., libs/auth/**, libs/crypto-service/**>
Trigger hints:
  - task-class:review-security
  - trust-boundary:<boundary name>
Helps with: review-security, add-auth, audit-permissions
Confidence: <high|medium|low>

<metadata>
...
</metadata>
```

- Title: `Scan: Security model`
- Tags: `source:scan`, `scan-category:security`, `scope:auth`
- Importance: 7
- One entry per repo (or split if auth and crypto are separate concerns)
- Note: Security rules appear in only 14.5% of context files
  (Chatlatanagulchai) but are the highest-value rules. The scanner MUST
  actively search ALL docs for security-related MUST/NEVER statements,
  not just dedicated security docs. Extract from ARCHITECTURE.md,
  MISSION_INTEGRITY.md, journal entries about auth changes, etc.

#### Domain knowledge

```
Entity: <business concept or domain object>
Definition: <what it represents>
Invariants: <rules that must always hold — these are hard constraints>
Naming: <how it's referred to in code vs docs vs UI>
Relationships: <how it connects to other entities>
Lifecycle: <states, transitions, ownership>
Constraints:
  - MUST: <domain invariants expressed as rules>
  - NEVER: <domain violations — e.g., "never create diary without owner">
Applies to: <file glob where this entity is handled>
Helps with: <1-3 task classes, e.g., add-feature, understand-domain, review-code>
Confidence: <high|medium|low>

<metadata>
...
</metadata>
```

- Title: `Scan: Domain — <entity or concept>`
- Tags: `source:scan`, `scan-category:domain`, `scope:<area>`
- Importance: 5-6
- One entry per major domain concept (not per database table)
- Note: Domain `Invariants:` are the most valuable rule source here.
  They map directly to hard constraints that prevent data corruption.

#### Known issues and caveats

```
Issue: <what the problem is>
Context: <when it manifests>
Trigger: <what task or action causes this to surface>
Workaround: <current mitigation — exact commands if applicable>
Error signature: <what the error message looks like>
Status: <open|mitigated|resolved>
Impact: <what breaks if you hit this>
Constraints:
  - NEVER: <what to avoid to prevent this>
  - MUST: <what to do when encountering this>
Applies to: <file glob where this issue is relevant>
Helps with: <1-3 task classes, e.g., debug-issue, avoid-pitfall, onboard-developer>
Confidence: <high|medium|low>

<metadata>
...
</metadata>
```

- Title: `Scan: Caveat — <short description>`
- Tags: `source:scan`, `scan-category:incident`, `incident`, `scope:<area>`
- Entry type: `episodic`
- Importance: 4-6
- One entry per distinct issue
- Note: Caveats are high-value negative rules. The `Error signature:` field
  helps agents recognize known issues. `Trigger:` maps directly to the
  nugget trigger type.

## Scan execution workflow

### Step 1: Dry-run plan (mandatory)

Before reading any source files beyond what's needed for discovery, produce a
scan plan and present it to the user for approval.

Generate the scan session ID at this step: an ISO-8601 UTC timestamp
(e.g., `2026-03-01T14:30:00Z`). This ID is used as the `scan-session` tag
and metadata value for every entry in this scan. Write it in the plan.

Also assign:

- a `scan-batch` ID for every planned batch (e.g., `phase1-b1`,
  `phase2-tier0`, `phase2-tier1`)
- a stable `scan-entry-key` for every planned entry

`scan-entry-key` is required because one source file may produce multiple
entries. Format:

`<category>:<subject-slug>`

Examples:

- `architecture:rest-api`
- `architecture:mcp-server`
- `workflow:test`
- `decision:signed-diary-commits`

The plan should include the enry output if available. Run enry before
producing the plan:

```bash
# Check availability
which enry 2>/dev/null && enry --json -prog . || echo "enry not available"
```

If enry is available, include its output in the plan. If not, prompt the user
and fall back to manifest-based detection.

```
Scan plan for <repo-name>
Session: <scan-session-id>
Mode: <bootstrap|deep>
Branch: <current branch>

=== Language detection (enry) ===

<enry output or "enry not available — using manifest-based detection">

Language zones:
  - TypeScript: apps/, libs/, tools/
  - SQL: libs/database/drizzle/
  ...

=== Phase 1: Documentation & config ===

Batches:
  - phase1-b1:
      categories: [identity, structure]
      files:
        - README.md
        - package.json
        - pnpm-workspace.yaml
      planned_entries:
        - identity:project-identity
        - architecture:project-structure
  - phase1-b2:
      categories: [architecture]
      files:
        - docs/ARCHITECTURE.md
      planned_entries:
        - architecture:rest-api
        - architecture:mcp-server
        - architecture:auth-flow
  - ...

Categories to emit:
  - identity: 1 entry
  - structure: 1 entry
  - architecture: 3-4 entries (from docs)
  - workflow: 2 entries
  - testing: 1 entry
  - security: 1 entry
  - caveat: 0-2 entries

Estimated Phase 1 entries: <N>

=== Phase 2: Code-aware scan ===

Project graph (from workspace config):
  Tier 0 (leaf libs): database, models, crypto-service, embedding-service, observability
  Tier 1 (mid libs): auth, diary-service, api-client
  Tier 2 (apps): rest-api, mcp-server, landing

Per-package files:
  libs/database:
    batch: phase2-tier0
    planned_entry: architecture:libs-database
    entry: src/index.ts
    pattern: src/repositories/<most recent>.ts
    test: <first test file found>
  libs/auth:
    batch: phase2-tier1
    planned_entry: architecture:libs-auth
    entry: src/index.ts
    pattern: src/<main service file>.ts
    test: <first test file found>
  apps/rest-api:
    batch: phase2-tier2
    planned_entry: architecture:apps-rest-api
    entry: src/index.ts
    pattern: src/routes/<most recent>.ts
    test: test/e2e/<first e2e file found>
  ...

Packages to skip (thin/generated):
  - libs/models (mostly TypeBox schemas, generated-like)
  - libs/api-client (generated from OpenAPI)

Estimated Phase 2 entries: <N>

=== Totals ===

Estimated total entries: <Phase 1 + Phase 2>
Phase 1 batches: <N>
Phase 2 tiers: <N> (packages within a tier run in parallel)

Skipped (secret/unsafe):
  - .env, .env.local
  - genesis-credentials.json

Skipped (not found):
  - No CONTRIBUTING.md
  - No TROUBLESHOOTING.md
```

**Wait for user approval before proceeding.** The user may:

- Remove files or packages from the scan list
- Add files the discovery missed
- Switch modes
- Adjust batch count
- Skip Phase 2 entirely (docs-only scan)

### Step 2: Phase 1 — Read docs and extract (batched)

Process Phase 1 scan targets (docs, config) in batches to manage context
window pressure (see "Context window strategy" section below).

For each scan target:

```
1. Read the source file
2. Determine scan category
3. Extract structured content using the category template
4. Resolve refs (file paths, modules, services, endpoints)
5. Determine importance level and confidence
6. Build the entry content with metadata block
```

**Extraction rules:**

- **Summarize, don't copy.** The entry should capture the essential knowledge
  from the source, not reproduce it verbatim. Aim for 100-500 words per entry.
- **One concept per entry.** If a doc covers 3 separate architectural
  components, create 3 entries.
- **Constraints first.** Scan for MUST/NEVER/ALWAYS/PREFER statements before
  writing descriptive text. These are the highest-value output. If the source
  says "never do X" or "always do Y", put these in the `Constraints:` field.
  If the source documents what was rejected and why, put these in `Anti-patterns:`.
- **Non-redundancy filter.** Only extract constraints not already inferable
  from the code structure. "Use TypeScript" is noise (there's a tsconfig.json).
  "NEVER use paths aliases in tsconfig.json" is a real constraint. Ask: would
  an agent reading just the code and config still get this wrong? If yes,
  extract it. If no, skip it.
- **Preserve decisions and rationale.** If the source says "we chose X because
  Y", capture both X and Y — this is the most valuable signal for future agents.
  Decisions are a rich source of NEVER constraints (what was rejected and why).
- **Capture task relevance.** For each entry, think: "what task would an agent
  need this knowledge for?" Add a `Helps with:` line listing 1-3 task classes
  (e.g., `add-feature`, `debug-auth`, `write-e2e-test`, `review-security`,
  `onboard-developer`). This directly feeds tile `helps_with` during
  consolidation.
- **Keep constraints atomic.** Split unrelated MUST/NEVER/PREFER items into
  separate bullets. Do not bundle multiple rules into one line.
- **Assign confidence.** Use `high` if the knowledge comes directly from a
  doc. Use `medium` if confirmed by cross-referencing config/code. Use `low`
  if inferred from structure only.
- **Note staleness.** If the source appears outdated (references removed
  features, old versions, deprecated APIs), note this in the content and lower
  the importance.
- **Cross-reference via refs.** If two sources discuss the same component, use
  matching `refs:` values in both entries. This enables consolidation to group
  related entries across categories.
- **Nugget acceptance gate.** When populating `Constraints:` and
  `Anti-patterns:`, apply this filter to each candidate rule: is it
  **triggerable** (clear when it applies), **specific** (real convention,
  not vague), **bounded** (fits one subsystem or task family), **grounded**
  (links to concrete files), and **actionable** (agent can follow it or
  validator can check it)? If a candidate fails, keep it as descriptive text
  rather than promoting it to a constraint.

### Step 3: Create Phase 1 entries

For each extracted entry:

```
1. Call entries_create({
     diary_id: DIARY_ID,
     title: "Scan: <category> — <subject>",
     content: <structured content with metadata block>,
     entry_type: <semantic|episodic|reflection>,
     tags: ["source:scan", "scan-session:<id>", "scan-category:<cat>",
       "scan-batch:<batch-id>", "scope:<scope>", ...],
     importance: <1-10>
   })
2. Log the entry ID for the scan report
```

Do not verify returned fields beyond checking for errors — minimize API calls.

### Step 4: Phase 2 — Code-aware scan

After Phase 1 entries are created, execute the code-aware scan:

1. **Build the project graph** from the structure entry and workspace config.
   Parse each package's dependencies to determine the topological order.

2. **Identify representative files** per package. For each package in the
   scan plan, resolve the concrete file paths:
   - Entry point: check `package.json` `exports` or `main` field
   - Pattern file: `ls` the source directory, pick the most recently
     modified non-index file in the main source dir (e.g., `src/routes/`,
     `src/repositories/`, `src/services/`)
   - Test file: find the first `.test.ts` or `.spec.ts` file, preferring
     integration/e2e over unit

3. **Build convention digests** from Phase 1 entries. For each Phase 1
   architecture entry, extract a ~200-token digest:
   ```
   <package>: <key pattern>, <key constraint>, <key convention>
   ```

4. **Spawn tier-0 subagents** (leaf packages, no internal deps). These run
   in parallel. Each receives:
   - The Phase 2 subagent prompt template
   - No upstream context (they are the leaves)
   - Their assigned files

5. **Collect tier-0 results**, build convention digests for scanned packages.

6. **Spawn tier-1 subagents** with upstream digests from their tier-0 deps.

7. **Spawn tier-2 subagents** with upstream digests from their tier-0+1 deps.

8. **Collect all Phase 2 entry IDs** for the summary.

Between tiers, the primary agent holds only:
- The scan plan
- Phase 1 entry IDs + titles
- Convention digests (~200 tokens per package)
- Phase 2 entry IDs + titles + constraint counts

### Step 5: Create scan summary (covers both phases)

After all entries are created, write one `reflection` entry summarizing the
scan. This summary is the first Observe artifact — it tells the next agent
(or the consolidation step) what was covered and what's missing.

```
Scan summary for <repo-name>
Mode: <bootstrap|deep>
Date: <timestamp>
Entries created: <count>

Coverage:
  categories_covered: <list with entry count per category>
  categories_missing: <list — categories with no source material found>
  categories_partial: <list — categories with low-confidence entries only>
  constraints_extracted: <total MUST/NEVER/PREFER count across all entries>
  anti_patterns_extracted: <total anti-pattern count>

Gaps:
  - <gap description — e.g., "No testing docs found; testing entry inferred
    from config only (low confidence)">
  - <gap description — e.g., "Security model inferred from Ory config files;
    no dedicated security documentation exists">
  - <gap description — e.g., "Architecture docs cover REST API but not MCP
    server; MCP architecture entry is partial">

Sources skipped:
  unsafe: <list of files skipped for secret/safety reasons>
  not_found: <list of expected doc paths that don't exist>

Staleness:
  - <source file>: <reason it appears outdated>

Low-confidence entries (recommend human review):
  - <entry title>: <why confidence is low>

Recommended next:
  - <what a human or follow-up scan should address>
  - <what tiles could be derived from current entries>

<metadata>
operator: <user>
tool: <tool>
scan-session: <scan-session-id>
scan-mode: <bootstrap|deep>
timestamp: <ISO-8601 UTC>
branch: <branch>
scope: scope:misc
</metadata>
```

- Title: `Scan: Summary — <repo-name>`
- Tags: `source:scan`, `scan-category:summary`, `reflection`
- Importance: 5

### Step 6: Report to user

Print a summary table:

```
=== Phase 1 (docs & config) ===
| # | Category | Title | Confidence | Entry ID | Constraints |
|---|---|---|---|---|---|
| 1 | identity | Scan: Project identity — moltnet | high | abc-123 | 4 |
| 2 | architecture | Scan: Architecture — rest-api | high | def-456 | 3 |
| 3 | testing | Scan: Testing conventions | medium | ghi-789 | 2 |
...

=== Phase 2 (code-aware) ===
| # | Package | Title | Confidence | Entry ID | Patterns |
|---|---|---|---|---|---|
| 1 | libs/database | Scan: Code — database | medium | jkl-012 | repository |
| 2 | libs/auth | Scan: Code — auth | medium | mno-345 | jwt-plugin |
| 3 | apps/rest-api | Scan: Code — rest-api | medium | pqr-678 | route-plugin |
...

Totals: <Phase 1 entries> + <Phase 2 entries> = <total>
Constraints extracted: <count>
Canonical patterns found: <count>
Packages skipped (thin): <count>
Gaps found: <count>
Low-confidence entries: <count>
```

## Context window strategy

**This is the most important operational concern for the scan workflow.**

A full scan reads many files and creates many entries. Without management, the
agent will exhaust its context window mid-scan, losing the scan plan, the
accumulated entry IDs, and the ability to produce a coherent summary.

### Principles

1. **The scan plan is the checkpoint.** It is produced in Step 1, approved by
   the user, and serves as the recovery document if context is compressed.
2. **Batch by category, not by file.** Each batch should process one or two
   related categories end-to-end (read sources → extract → create entries).
   This keeps related context together and allows earlier file contents to be
   evicted before the next batch.
3. **Write entries immediately.** Do not accumulate extracted content in
   memory. Read a file, extract, call `entries_create`, log the ID, move on.
   The diary is the durable store — the context window is not.
4. **The summary entry uses entry IDs, not entry content.** The scan summary
   references entries by ID and title. It does not need to hold full entry
   content in context.

### Batch structure

Split the scan into batches based on category groups. Keep batches small —
the enriched templates with Constraints/Anti-patterns/Verification fields
require more cognitive work per file than plain description.

| Batch         | Categories                    | Typical files                               | Expected entries |
| ------------- | ----------------------------- | ------------------------------------------- | ---------------- |
| 1             | identity, structure           | README, package.json, workspace config      | 2-3              |
| 2             | architecture                  | Architecture docs, design docs              | 2-4              |
| 3             | workflow, testing             | CONTRIBUTING, CI config, test config        | 2-4              |
| 4             | security, caveat              | Auth docs, troubleshooting, journal handoff | 1-3              |
| 5 (deep only) | plans, decisions              | ADRs, RFCs, plans                           | 2-4              |
| 6 (deep only) | infrastructure, domain        | Infra config, schemas                       | 2-4              |

**Rule of thumb**: no batch should produce more than 4 entries. If a category
would produce 5+ entries (e.g., architecture on a large monorepo), split it
into two batches by subsystem.

Between batches, the agent should:

- Log a running tally: `Batch N complete: M entries created so far, C constraints extracted`
- Release file contents from working memory (don't re-read them)
- Keep only: scan plan, entry ID list, running tally, constraint counts

### Subagent execution (preferred for most scans)

When subagent support is available, delegate per-batch to subagents:

- **Primary agent**: produces the scan plan, assigns batches, collects
  entry IDs, writes the summary
- **Batch subagent**: receives a batch assignment (category list + file list
  + DIARY_ID), reads files, creates entries, returns entry IDs + titles +
    confidence levels + constraint counts

Each subagent gets a fresh context window. The primary agent's context holds
only the plan and the collected results, not the file contents.

This is the **recommended approach for repos with 10+ expected entries**.
The enriched templates (with Constraints, Anti-patterns, Applies to,
Verification) require more cognitive work per file than plain description.
Subagent delegation keeps each batch within a manageable context budget.

**When to use subagents vs single-agent:**

| Expected entries | Approach | Rationale |
| --- | --- | --- |
| < 10 | Single agent, batched | Small enough to fit in one context window |
| 10-20 | Subagents, 2-3 batches | Enriched templates need fresh context per batch |
| 20+ | Subagents, 4-5 batches | Deep scan on large repo, mandatory delegation |

Subagent prompt template:

```
You are executing batch <N> of a LeGreffier scan.
Diary ID: <DIARY_ID>
Scan session: <scan-session-id>
Scan mode: <bootstrap|deep>
Repo: <repo-name>

Your assignment:
  Categories: <list>
  Files to read: <list>

For each file:
1. Read the file
2. Scan for MUST/NEVER/ALWAYS/PREFER statements FIRST — these populate
   the Constraints: field and are the highest-value output
3. Extract entries using the templates below
4. Apply the non-redundancy filter: skip constraints already inferable
   from code structure (e.g., "use TypeScript" when tsconfig.json exists)
5. Apply the nugget acceptance gate to each constraint: is it triggerable,
   specific, bounded, grounded, and actionable? If not, keep it as
   descriptive text, not a constraint.
6. Create each entry via entries_create — include tags:
   ["source:scan", "scan-session:<scan-session-id>", "scan-category:<cat>",
    "scan-batch:<batch-id>", "scope:<scope>"]
7. Include metadata:
   - scan-batch: <batch-id>
   - scan-entry-key: <category>:<subject-slug>
8. Return the list:
   [{ id, title, category, confidence, constraint_count, scan_entry_key }]

Entry templates:
<paste only the relevant category templates for this batch>

Extraction priorities:
- Constraints (MUST/NEVER) > Anti-patterns > Canonical patterns > Description
- If running low on context, prioritize constraints over descriptive fields
- Write entries immediately after extraction — don't accumulate

Do not create a summary entry — the primary agent handles that.
```

### Context budget per batch

Each batch subagent should aim to stay within this budget:

| Context section | Approximate tokens | Notes |
| --- | --- | --- |
| Prompt + templates | 2,000-3,000 | Only templates for assigned categories |
| File reads (2-4 files) | 3,000-8,000 | Depends on file size |
| Entry composition | 1,500-3,000 | 100-500 words per entry |
| API calls overhead | 500-1,000 | entries_create calls |
| **Total per batch** | **7,000-15,000** | Well within a single context window |

If a single file is very large (> 3,000 tokens), the subagent should read it
in sections or extract only the constraint-relevant portions. Large README or
ARCHITECTURE files should be read with targeted grep for MUST/NEVER/ALWAYS
keywords before full extraction.

### Recovery after context compression

If the agent's context is compressed mid-scan:

1. Retrieve the scan session ID from the scan plan (which should be in the
   conversation summary or the user's approval message)
2. Query only this session's entries:
   `entries_search({ query: "<scan-session-id>", tags: ["scan-session:<scan-session-id>"] })`
3. Compare returned entries against the scan plan to determine which batches
   are complete (match by `scan-batch` tags and planned `scan-entry-key` values)
4. Resume from the next incomplete batch
5. Note the interruption in the scan summary

The session ID is the key that makes recovery reliable — it filters out entries
from previous scans. Without it, recovery would return a mix of current and
stale entries.

The scan plan + session-tagged diary entries together form a durable checkpoint
that survives context compression.

## Re-scan behavior

When re-scanning a repo that already has scan entries, download the previous
scan state locally first, diff locally, then push changes. This minimizes API
calls and keeps the comparison logic in a single pass.

### Step 1: Download previous scan state (2 API calls)

```
1. entries_search({
     query: "Scan: Summary",
     tags: ["source:scan", "scan-category:summary"],
     exclude_superseded: true,
     limit: 1
   })
   → extract prev_session_id and prev_summary_id

2. entries_list({
     diary_id: DIARY_ID,
     tags: ["source:scan", "scan-session:<prev_session_id>"],
     limit: 100
   })
   → download all entries from the previous scan session
```

### Step 2: Build local index (zero API calls)

Parse each downloaded entry's content to extract the `<metadata>` block.
Build an in-memory index:

```
{
  "architecture:rest-api": {
    entry_id, source: "docs/ARCHITECTURE.md", digest: "a1b2c3d4...", category, title
  },
  "identity:project-identity": {
    entry_id, source: "README.md", digest: "e5f6g7h8...", category, title
  },
  ...
}
```

Key: `scan-entry-key` value → value: entry ID + source + digest + category.

### Step 3: Diff against current files (zero API calls)

For each planned entry in the new scan plan:

- compute the source digest for that entry's source file
- look up `scan-entry-key` in the local index
- classify as:
  - `unchanged` if the entry key exists and the source digest matches
  - `changed` if the entry key exists and the source digest differs
  - `new` if the entry key does not exist in the previous session
  - `deleted` if an old entry key exists in the previous session but not in the new plan

### Step 4: Execute changes (only for changed/new entries)

- **unchanged**: skip entirely — no API call
- **changed**: create new entry, then supersede old:
  `entries_create(...)` then `entries_update({ entry_id: <old>, superseded_by: <new> })`
- **new**: create new entry only
- **deleted**: note in scan summary, do not delete old entry

### Step 5: Supersede the previous summary

After all new entries are created:

```
entries_update({ entry_id: <prev_summary_id>, superseded_by: <new_summary_id> })
```

This is the critical step. Even if individual entry supersession is incomplete
(e.g., the agent ran out of context before superseding all changed entries),
the summary supersession chain tells consumers which session is authoritative.

### Best-effort individual supersession

Individual entry supersession (step 6) is best-effort. If the agent can't
complete it (context pressure, crash, timeout), the system still works because:

- The new summary entry lists the current session ID
- Consumers resolve the current session from the summary chain (see below)
- Old entries from previous sessions are implicitly stale

### How consumers resolve the current scan session

Any tool or workflow that reads scan entries (consolidation, session pack
assembly, the `reflect` tool) should follow this protocol:

1. Find the most recent **non-superseded** scan summary:
   `entries_search({ query: "Scan: Summary", tags: ["scan-category:summary"], exclude_superseded: true })`
2. Extract `scan-session` from that summary's metadata — this is the
   **authoritative session ID**
3. Query entries from that session only:
   `entries_search({ tags: ["scan-session:<authoritative-session-id>"] })`
4. Ignore entries from other scan sessions, even if they're not formally
   superseded

This means the summary supersession chain is the only thing that _must_ be
maintained. Individual entry supersession is nice-to-have for cleanliness but
not required for correctness.

## What the scan does NOT do

- Does not create `procedural` entries (those are for commits)
- Does not sign entries (scan entries are not part of the accountability chain)
- Does not produce tiles or packs (that's the consolidation step)
- Does not read source code exhaustively (Phase 2 reads targeted files only —
  entry points, one representative pattern, one test — not every file)
- Does not replace existing organic entries (scan entries coexist with them)
- Does not evaluate whether the extracted knowledge is correct (that's the
  eval step)

## Entry count guidance

Aim for the right granularity. Counts include both Phase 1 and Phase 2 entries.

| Repo size                        | Bootstrap entries | Deep entries | Rationale                                          |
| -------------------------------- | ----------------- | ------------ | -------------------------------------------------- |
| Small (< 10 files, no docs)      | 8-15              | 12-20        | Identity, structure, workflow + 2-4 code entries   |
| Medium (10-100 files, some docs) | 15-25             | 25-40        | Above + architecture, testing, security + code     |
| Large (100+ files, rich docs)    | 20-30             | 35-50        | Above + multiple architecture entries + code       |
| Monorepo (many packages)         | 20-35             | 40-60        | Above + per-package code-aware entries             |

Phase 2 typically adds 1 entry per scanned package (not per file). A monorepo
with 15 packages might add 8-12 Phase 2 entries (thin packages are skipped).

More than 60 entries suggests the scan is too granular. Consolidate at the
scan level — don't create entries per file or per function.

## Consolidation: tiles and rule nuggets

After a scan is complete, the consolidation step transforms raw evidence entries
into two outputs: **context tiles** and **rule nuggets**. This is the second
stage of the context flywheel (Generate → **Consolidate** → Load → Eval).

See `docs/research/scan-consolidation-approach.md` for the full execution
playbook. This section covers the tagging and evaluation protocol.

### Context tiles

A tile is a synthesized knowledge unit (~200-400 tokens) that merges related
scan entries into a single, scoped, task-ready block. Tiles answer:

> "What do I need to know about X to work on Y correctly?"

Tile entries use these tags:

```
source:tile
tile-session:<ISO-8601 timestamp — unique per consolidation run>
tile-scope:<scope, e.g., libs/database, apps/rest-api, misc>
tile-id:<scope>/<topic>
model:<model-short-tag>
```

The `model:` tag identifies which model produced the tile. The `tile-session:`
tag isolates runs — even re-runs with the same model get a new timestamp.

### Rule nuggets

A nugget is an atomic constraint (~120 tokens) with a trigger, scope, and
verification method. Nuggets are the output that a runtime control plane
can load selectively at task time.

Nugget entries use these tags:

```
source:nugget
nugget-session:<same timestamp as tile-session for this run>
nugget-domain:<domain, e.g., testing, security, workflow, database>
nugget-id:<domain>.<subsystem>.<constraint-slug>
model:<model-short-tag>
```

### Multi-model evaluation protocol

When comparing consolidation quality across models, all runs use the same
scan entries as fixed input. Only the consolidation step varies.

**Models under test** should be tagged with their canonical short names:

| Example model | Short tag |
|---|---|
| Claude Sonnet 4.6 | `claude-sonnet-4.6` |
| Claude Opus 4.6 | `claude-opus-4.6` |
| GPT 5.2 | `gpt-5.2` |
| GPT 5.3 | `gpt-5.3` |

**Evaluation dimensions** per model run:

| Dimension | What it measures |
|---|---|
| Constraint yield | `accepted_nuggets / total_candidates` |
| Specificity | Are constraints concrete? (1-5 avg) |
| Non-redundancy | Count of nuggets restating obvious code structure |
| Trigger precision | False-positive rate (low/med/high) |
| Merge quality | Phase 1 + Phase 2 synthesis quality (1-5 avg) |
| Token efficiency | `total_constraints / total_tokens` |
| Hallucination rate | Count of constraints not in source entries |
| Coverage | `constraints_found / constraints_in_sources` |
| Consistency | Jaccard similarity with other models' nugget sets |

**Scorecard entry** — after each run, store a scorecard:

```
Tags: source:scorecard, tile-session:<run-timestamp>,
      model:<model-short-tag>, scan-session:<original-scan-session>
Entry type: reflection
Importance: 7
```

Content: YAML block with all dimension scores + free-text observations.

**Cross-model comparison** — after all runs, produce a comparison entry:

```
Tags: source:scorecard, scorecard-type:comparison,
      scan-session:<original-scan-session>
```

Content: constraint overlap matrix, quality ranking, cost-quality tradeoff,
failure modes per model.

### Retrieval queries for evaluation

```
# All tiles from a specific model
entries_search({
  query: "tile",
  tags: ["source:tile", "tile-session:<run-timestamp>", "model:<tag>"],
  diary_id: "<DIARY_ID>"
})

# All nuggets from a specific model
entries_search({
  query: "nugget",
  tags: ["source:nugget", "nugget-session:<run-timestamp>", "model:<tag>"],
  diary_id: "<DIARY_ID>"
})

# All scorecards for cross-model comparison
entries_search({
  query: "scorecard",
  tags: ["source:scorecard", "scan-session:<original-scan-session>"],
  diary_id: "<DIARY_ID>"
})
```

## Permissions

- Scan entries use the same diary as organic LeGreffier entries
- Diary visibility should be `moltnet` (standard for team-visible entries)
- No signing is required for scan entries (they're derived, not accountable)
- The scan agent must have write access to the diary (standard LeGreffier
  identity is sufficient)
