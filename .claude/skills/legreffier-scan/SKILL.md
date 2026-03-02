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

## Prerequisites

- LeGreffier must be initialized for this repo (`.moltnet/` directory exists)
- Agent identity must be active (`moltnet_whoami` returns a valid identity)
- A diary must exist for this repo (`diaries_list` returns a matching diary)
- `DIARY_ID` and `AGENT_NAME` must be resolved (use the `legreffier` skill
  activation steps if not already done)

## When to trigger

- First time an agent works on a repo that has no diary entries yet
- When the repo has changed significantly since the last scan
- When a user explicitly asks to scan or bootstrap the diary
- When onboarding a new design partner repo

## Scan modes

### Bootstrap (default)

Fast, safe first pass. Use this for the first scan of any repo.

- Targets: docs, project config, workspace layout, CI config
- Entry count: 8-20
- Categories: identity, architecture, workflow, testing, security, caveat
- Additional categories (domain, infrastructure, plans) are emitted only if
  high-quality source docs exist — do not infer from code structure alone
- Goal: generate a usable evidence base quickly

### Deep (explicit request only)

Comprehensive scan for repos with rich documentation. Only use when the user
explicitly requests a deep scan or when re-scanning after significant changes.

- Targets: all documentation, config, schemas, journal entries, ADRs
- Entry count: 20-40
- All categories active
- Goal: capture full repo knowledge including domain, infrastructure, plans,
  incidents

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

The scan targets **documentation and configuration artifacts**, not source code
line-by-line. Source code structure matters (what modules exist, what patterns
they follow), but the scan does not create entries per function or class.

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

### Path discovery

The scan must adapt to each repo's structure. Not every repo has `docs/plans/`.
Use this discovery approach:

1. Read root `README.md` — it usually describes project structure
2. List top-level directories: `ls -1`
3. Check for common doc patterns:
   - `docs/`, `doc/`, `documentation/`
   - `adr/`, `decisions/`, `rfcs/`
   - `plans/`, `research/`
   - `journal/`, `changelog/`
4. Check for workspace configs:
   - `pnpm-workspace.yaml`, `lerna.json`, `turbo.json` (JS/TS)
   - `Cargo.toml` with `[workspace]` (Rust)
   - `go.work` (Go)
   - `pyproject.toml` with workspace config (Python)
5. Check for existing agent context:
   - `CLAUDE.md`, `AGENTS.md`, `CODEX.md`, `.cursorrules`
   - `.claude/`, `.github/copilot-instructions.md`

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
| `scan-source`        | relative file path                                      | Which file this entry was extracted from                                                                                |
| `scan-source-type`   | `doc`, `config`, `schema`, `workflow`, `code-structure` | What kind of artifact the source is                                                                                     |
| `scan-source-digest` | first 16 chars of SHA-256 hex                           | Content-based staleness detection on re-scan (stable across rebases, works for untracked files)                         |
| `scan-mode`          | `bootstrap` or `deep`                                   | Which scan mode produced this entry                                                                                     |
| `confidence`         | `high`, `medium`, `low`                                 | How well-sourced this entry is                                                                                          |

### Content structure per scan category

Each category has a deterministic content template. This consistency is critical
for consolidation — the consolidation step must be able to parse scan entries
reliably.

#### Project identity

```
Project: <name>
Purpose: <1-2 sentences>
Tech stack: <languages, frameworks, runtime>
Maturity: <early/active/stable/maintenance>
Repository type: <monorepo|single-package|multi-repo>
Key dependencies: <3-5 most important external deps>
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

#### Architecture

```
Component: <name or subsystem>
Purpose: <what it does>
Boundaries: <what it owns, what it delegates>
Key abstractions: <patterns, interfaces, data models>
Dependencies: <what it depends on, what depends on it>
Conventions: <naming, file layout, import rules>
Data flow: <how data moves through this component>
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

#### Plan or decision (ADR)

```
Decision: <what was decided>
Date: <when, from the document>
Status: <active|superseded|proposed>
Context: <why the decision was needed>
Alternatives considered: <what else was evaluated>
Reason chosen: <why this option>
Trade-offs: <what was given up>
Implications: <what this means for future work>
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

#### Developer workflow

```
Workflow: <name — build|test|deploy|review|release>
Commands:
  - <command 1>: <what it does>
  - <command 2>: <what it does>
Prerequisites: <what must be true before running>
Common pitfalls: <what breaks and how to fix>
CI integration: <how this relates to CI pipeline>
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

#### Project structure (workspace/module layout)

```
Structure: <monorepo|single-package|...>
Layout:
  - <dir/>: <purpose> (<framework/pattern>)
  - <dir/>: <purpose>
Module boundaries: <what can import what>
Shared code: <where shared utilities/types live>
Build order: <dependency/build topology if relevant>
Helps with: onboard-developer, understand-codebase, add-module
Confidence: <high|medium|low>

<metadata>
...
</metadata>
```

- Title: `Scan: Project structure`
- Tags: `source:scan`, `scan-category:architecture`, `scope:misc`
- Importance: 6
- One entry per repo (or one per workspace root in multi-repo)

#### Testing conventions

```
Framework: <test framework and version>
Test types:
  - unit: <location pattern, run command>
  - integration: <location pattern, run command, prerequisites>
  - e2e: <location pattern, run command, prerequisites>
Patterns: <AAA, BDD, etc.>
Fixtures: <where fixtures live, how to create them>
CI integration: <how tests run in CI>
Known issues: <flaky tests, slow suites, workarounds>
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

#### Infrastructure

```
Service: <name>
Role: <what it does in the system>
Provider: <where it runs — local Docker, cloud, managed>
Configuration: <where config lives, key env vars>
Dependencies: <what other services it needs>
Local setup: <how to run locally>
Deployment: <how it gets deployed>
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
Secret management: <how secrets are stored and accessed>
Key patterns: <signing, encryption, token lifecycle>
Known constraints: <security limitations, accepted risks>
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

#### Domain knowledge

```
Entity: <business concept or domain object>
Definition: <what it represents>
Invariants: <rules that must always hold>
Naming: <how it's referred to in code vs docs vs UI>
Relationships: <how it connects to other entities>
Lifecycle: <states, transitions, ownership>
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

#### Known issues and caveats

```
Issue: <what the problem is>
Context: <when it manifests>
Workaround: <current mitigation if any>
Status: <open|mitigated|resolved>
Impact: <what breaks if you hit this>
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

## Scan execution workflow

### Step 1: Dry-run plan (mandatory)

Before reading any source files beyond what's needed for discovery, produce a
scan plan and present it to the user for approval.

Generate the scan session ID at this step: an ISO-8601 UTC timestamp
(e.g., `2026-03-01T14:30:00Z`). This ID is used as the `scan-session` tag
and metadata value for every entry in this scan. Write it in the plan.

```
Scan plan for <repo-name>
Session: <scan-session-id>
Mode: <bootstrap|deep>
Branch: <current branch>

Files to scan:
  1. README.md (identity, workflow)
  2. docs/ARCHITECTURE.md (architecture)
  3. ...

Categories to emit:
  - identity: 1 entry
  - architecture: 3-4 entries
  - workflow: 2 entries
  - testing: 1 entry
  - security: 1 entry
  - caveat: 0-2 entries

Estimated entry count: <N>

Skipped (secret/unsafe):
  - .env, .env.local
  - genesis-credentials.json

Skipped (not found):
  - No ADR folder found
  - No TROUBLESHOOTING.md

Batches: <N> (see context window strategy)
```

**Wait for user approval before proceeding.** The user may:

- Remove files from the scan list
- Add files the discovery missed
- Switch modes
- Adjust batch count

### Step 2: Read and extract (batched)

Process scan targets in batches to manage context window pressure (see
"Context window strategy" section below).

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
- **Preserve decisions and rationale.** If the source says "we chose X because
  Y", capture both X and Y — this is the most valuable signal for future agents.
- **Capture constraints.** If the source says "never do X" or "always do Y",
  capture these as rules. They're the first thing consolidation will extract.
- **Capture task relevance.** For each entry, think: "what task would an agent
  need this knowledge for?" Add a `Helps with:` line listing 1-3 task classes
  (e.g., `add-feature`, `debug-auth`, `write-e2e-test`, `review-security`,
  `onboard-developer`). This directly feeds tile `helps_with` during
  consolidation.
- **Assign confidence.** Use `high` if the knowledge comes directly from a
  doc. Use `medium` if confirmed by cross-referencing config/code. Use `low`
  if inferred from structure only.
- **Note staleness.** If the source appears outdated (references removed
  features, old versions, deprecated APIs), note this in the content and lower
  the importance.
- **Cross-reference via refs.** If two sources discuss the same component, use
  matching `refs:` values in both entries. This enables consolidation to group
  related entries across categories.

### Step 3: Create entries

For each extracted entry:

```
1. Call entries_create({
     diary_id: DIARY_ID,
     title: "Scan: <category> — <subject>",
     content: <structured content with metadata block>,
     entry_type: <semantic|episodic|reflection>,
     tags: ["source:scan", "scan-category:<cat>", "scope:<scope>", ...],
     importance: <1-10>
   })
2. Log the entry ID for the scan report
```

Do not verify returned fields beyond checking for errors — minimize API calls.

### Step 4: Create scan summary

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

### Step 5: Report to user

Print a summary table:

```
| # | Category | Title | Confidence | Entry ID | Importance |
|---|---|---|---|---|---|
| 1 | identity | Scan: Project identity — moltnet | high | abc-123 | 7 |
| 2 | architecture | Scan: Architecture — rest-api | high | def-456 | 7 |
| 3 | testing | Scan: Testing conventions | medium | ghi-789 | 5 |
...

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

Split the scan into batches based on category groups:

| Batch         | Categories                    | Typical files                               | Expected entries |
| ------------- | ----------------------------- | ------------------------------------------- | ---------------- |
| 1             | identity, structure           | README, package.json, workspace config      | 2-3              |
| 2             | architecture                  | Architecture docs, design docs              | 3-6              |
| 3             | workflow, testing             | CONTRIBUTING, CI config, test config        | 2-4              |
| 4             | security, caveat              | Auth docs, troubleshooting, journal handoff | 1-3              |
| 5 (deep only) | plans, infrastructure, domain | ADRs, infra config, schemas                 | 3-8              |

Between batches, the agent should:

- Log a running tally: `Batch N complete: M entries created so far`
- Release file contents from working memory (don't re-read them)
- Keep only: scan plan, entry ID list, running tally

### Subagent execution (preferred for large repos)

When subagent support is available, delegate per-batch to subagents:

- **Primary agent**: produces the scan plan, assigns batches, collects
  entry IDs, writes the summary
- **Batch subagent**: receives a batch assignment (category list + file list
  - DIARY_ID), reads files, creates entries, returns entry IDs + titles +
    confidence levels

Each subagent gets a fresh context window. The primary agent's context holds
only the plan and the collected results, not the file contents.

This is the **recommended approach for repos with 15+ expected entries**.

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
2. Extract entries using the templates below
3. Create each entry via entries_create — include tags:
   ["source:scan", "scan-session:<scan-session-id>", "scan-category:<cat>", "scope:<scope>"]
4. Return the list: [{ id, title, category, confidence }]

Entry templates:
<paste only the relevant category templates>

Do not create a summary entry — the primary agent handles that.
```

### Recovery after context compression

If the agent's context is compressed mid-scan:

1. Retrieve the scan session ID from the scan plan (which should be in the
   conversation summary or the user's approval message)
2. Query only this session's entries:
   `entries_search({ query: "<scan-session-id>", tags: ["scan-session:<scan-session-id>"] })`
3. Compare returned entries against the scan plan to determine which batches
   are complete (match by `scan-category` tags)
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
  "docs/ARCHITECTURE.md": { entry_id, digest: "a1b2c3d4...", category, title },
  "README.md": { entry_id, digest: "e5f6g7h8...", category, title },
  ...
}
```

Key: `scan-source` value → value: entry ID + digest + category.

### Step 3: Diff against current files (zero API calls)

For each file in the new scan plan:

- Compute SHA-256 digest of the current file content (first 16 hex chars)
- Look up `scan-source` in the local index
- Classify as: `unchanged` (digest match), `changed` (digest differs),
  `new` (no previous entry), `deleted` (in index but not in scan plan)

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
- Does not read source code line by line (reads structure, not implementation)
- Does not replace existing organic entries (scan entries coexist with them)
- Does not evaluate whether the extracted knowledge is correct (that's the
  eval step)

## Entry count guidance

Aim for the right granularity:

| Repo size                        | Bootstrap entries | Deep entries | Rationale                                         |
| -------------------------------- | ----------------- | ------------ | ------------------------------------------------- |
| Small (< 10 files, no docs)      | 5-10              | 8-15         | Identity, structure, workflow, 1-2 key components |
| Medium (10-100 files, some docs) | 10-18             | 18-30        | Above + architecture, testing, security           |
| Large (100+ files, rich docs)    | 12-20             | 25-40        | Above + multiple architecture entries, incidents  |
| Monorepo (many packages)         | 15-20             | 30-50        | Above + per-workspace structure entries           |

More than 50 entries suggests the scan is too granular. Consolidate at the
scan level — don't create entries per file or per function.

## Permissions

- Scan entries use the same diary as organic LeGreffier entries
- Diary visibility should be `moltnet` (standard for team-visible entries)
- No signing is required for scan entries (they're derived, not accountable)
- The scan agent must have write access to the diary (standard LeGreffier
  identity is sufficient)
