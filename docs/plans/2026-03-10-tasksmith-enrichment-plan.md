# Plan: Tasksmith Enrichment via `MoltNet-Diary` and Observation Evidence

Date: 2026-03-10
Status: Draft execution plan
Related docs:

- [2026-03-10-tasksmith-harvesting-plan.md](./2026-03-10-tasksmith-harvesting-plan.md)
- [entry-relations-context-pipeline-proposal.md](./2026-03-07-entry-relations-context-pipeline-proposal.md)
- [DIARY_ENTRY_STATE_MODEL.md](../DIARY_ENTRY_STATE_MODEL.md)
- [entry-relations-flywheel-synthesis.md](../research/entry-relations-flywheel-synthesis.md)

## Goal

Use `MoltNet-Diary:` trailers and linked diary entries to enrich harvested task
records with rationale, failure patterns, and traceability signals.

This enrichment layer should improve:

- task descriptions
- later consolidation and compilation quality
- provenance from code change back to the underlying observation

This enrichment layer should not replace code-based verification.

## Principle

Commits define benchmark truth.

Diary entries provide:

- rationale
- symptoms
- workarounds
- failure patterns
- repo conventions worth distilling into nuggets

That means:

- harvesting decides whether a task is valid
- enrichment decides what evidence should travel with that task

## Why this matters

MoltNet has an advantage most repos do not:

- some commits already link to diary entries via `MoltNet-Diary: <entry-id>`

Those links can create a flywheel:

1. observation lands in diary
2. fix lands in git with trailer
3. task is harvested from commit history
4. linked diary entries are attached as task evidence
5. those entries are later prioritized during consolidation/compilation
6. resulting nuggets become more aligned with real failure patterns

## Key insight: trailer entries are procedural, not the whole story

Trailer-linked entries are almost always `procedural` "accountable commit"
records. They describe **what** was done, not **why**.

The real enrichment value comes from finding the related `episodic` and
`semantic` entries that explain the context:

- **episodic** entries: incidents, observations, symptoms, debugging sessions
- **semantic** entries: architecture scans, decision records, distilled knowledge

These related entries are discoverable through signals in the procedural entry:

- `branch:` tag → other entries on the same feature branch
- `scope:` tags → entries about the same subsystem
- `refs:` metadata field → file paths that appear in other entries
- content keywords → semantic search for related observations

### Resolution chain

```
commit trailer
  → procedural entry (accountable commit)
    → extract branch, scopes, refs, keywords
      → search for episodic entries (incidents, observations)
      → search for semantic entries (decisions, architecture scans)
        → assemble full evidence bundle per task
```

## Scope

This workstream does not need to implement continuous automation yet.

It should provide:

- evidence resolution (direct + related entry discovery)
- normalized evidence extraction
- task-level enrichment artifacts
- a benchmark-linked entry export for future consolidation

## Deliverables

### 1. Linked entry records

For each trailer-linked task, a record containing the resolved procedural entry
plus discovered related entries:

```json
{
  "task_id": "auth-permissions-export-relationshipreader-...",
  "linked_entry": {
    "id": "38ff84fa-...",
    "entry_type": "procedural",
    "title": "Accountable commit: wire RelationshipReader exports...",
    "tags": ["accountable-commit", "scope:auth"],
    "risk_level": "medium",
    "refs": ["libs/auth/src/index.ts", "..."],
    "summary": "Export RelationshipReader, add testcontainers deps..."
  },
  "related_entries": [
    {
      "id": "9f474ac0-...",
      "entry_type": "semantic",
      "title": "architecture:libs-auth — JWT validation and Keto...",
      "relation": "same_scope",
      "relevance_signal": "scope:auth"
    },
    {
      "id": "ad53dfac-...",
      "entry_type": "episodic",
      "title": "SECURITY: Authorization bypass — fetchEntriesStep...",
      "relation": "same_branch",
      "relevance_signal": "branch:feat/relationship-reader-diary-list-fix"
    }
  ]
}
```

### 2. Evidence cache

A cache of resolved diary entries:

```text
tasksmith/evidence/entries/
```

Each cached record should include:

- `entry_id`
- `title`
- `entry_type`
- `tags[]`
- `importance`
- `created_at`
- `signed`
- `content_excerpt`
- `resolution_status` (`resolved` | `not_found` | `error`)
- `metadata` (parsed from `<metadata>` block)
  - `operator`
  - `tool`
  - `risk_level`
  - `branch`
  - `scopes[]`
  - `refs[]`
  - `files_changed`

### 3. Enriched task records

For every harvested task with diary links, append:

- `linked_entry` — the resolved procedural entry
- `related_entries[]` — discovered episodic/semantic entries
- `evidence.failure_patterns[]`
- `evidence.repo_conventions[]`
- `evidence.workarounds[]`
- `evidence.decisions[]`
- `evidence.nugget_tags[]`

### 4. Benchmark-linked entry export

One artifact mapping benchmark tasks to diary evidence:

```text
tasksmith/evidence/benchmark-links.json
```

This should support later consolidation/compilation inputs.

### 5. Observation loop spec

A short section (below) that describes how new commits and diary entries are
ingested in the future.

## Workstreams

### Workstream A: Procedural entry resolution

Objective: resolve `MoltNet-Diary:` trailer IDs into structured linked entry
records.

For each `entry_id`:

- fetch entry via `entries_get`
- parse `<metadata>` block (works for both plain and `<moltnet-signed>` entries)
- extract: `operator`, `tool`, `risk_level`, `branch`, `scopes[]`, `refs[]`,
  `files_changed`
- strip `<metadata>` and `<moltnet-signed>` envelope to get plain content
- produce `linked_entry` record with summary (first ~300 chars of plain content)

If an entry cannot be resolved:

- keep the ID
- mark `resolution_status` explicitly
- do not drop the task record

Acceptance criteria:

- trailer-linked tasks resolve to entry metadata cleanly
- `<metadata>` block is parsed into structured fields, not stored as raw text
- missing or inaccessible entries are represented explicitly

### Workstream B: Related entry discovery

Objective: find episodic and semantic entries that provide context for each
procedural entry.

Discovery strategies (in priority order):

#### B1: Branch-based search

Search `entries_search` with the `branch:` tag from the procedural entry.
Filter for `episodic` and `semantic` entry types.

Example: procedural entry has `branch:feat/distill-exclude-tags` →
search for episodic entries tagged `branch:feat/distill-exclude-tags`.

This finds incident reports, debugging sessions, and observations from the
same feature branch.

#### B2: Scope-based search

Search `entries_search` with the `scope:` tags from the procedural entry.
Filter for `semantic` entry types (architecture scans, decision records).

Example: procedural entry has `scope:auth` →
search for semantic entries tagged `scope:auth` or `scope:libs/auth`.

This finds architecture documentation and design decisions for the subsystem.

#### B3: Content-based semantic search

Search `entries_search` with keywords extracted from the procedural entry
title and content. Filter for `episodic` and `semantic` entry types.

Example: procedural entry title contains "X25519 key derivation" →
semantic search returns the Ed25519 decision record and crypto-service
architecture scan.

This finds related knowledge that shares no branch or scope tags.

#### Deduplication

Related entries discovered through multiple strategies should be deduplicated
by `entry_id`. Keep the highest-relevance discovery signal.

#### Limits

- cap related entries at 5 per task
- prefer episodic entries (incidents, observations) over semantic entries
  (architecture scans) when both are found, since incidents carry more
  task-specific context
- exclude entries tagged `source:scan` with low importance (< 5) — these are
  bulk scan outputs that add noise

Acceptance criteria:

- at least 50% of diary-linked tasks have 1+ related entries
- related entries include episodic entries (not just architecture scans)
- discovery signals are recorded per related entry

### Workstream C: Evidence extraction

Objective: normalize diary content into structured evidence.

From the linked procedural entry, extract:

- `risk_level` → evidence metadata
- `scopes[]` → subsystem boundaries
- `refs[]` → affected files (for context, not leaked into problem statement)

From related episodic entries, extract:

- `symptom` — what went wrong (from incident entries)
- `root_cause` — why it went wrong
- `workaround` — temporary fix applied
- `verification_hint` — how to check if the issue is fixed

From related semantic entries, extract:

- `repo_convention` — rules or patterns the task touches
- `decision` — architectural decisions that constrain the solution space
- `nugget_candidate` — content suitable for distilling into a reusable nugget

Evidence categories:

| Category           | Source entry types     | Maps to nugget shape |
| ------------------ | --------------------- | -------------------- |
| `failure_pattern`  | episodic (incidents)   | pitfall nugget       |
| `repo_convention`  | semantic (scans/tiles) | rule nugget          |
| `decision`         | semantic (decisions)   | constraint nugget    |
| `workaround`       | episodic               | procedure nugget     |
| `verification_hint`| episodic               | checklist nugget     |

Acceptance criteria:

- evidence items are typed, not raw markdown
- later consolidation can filter or rank by evidence type
- evidence never contains the exact gold fix code

### Workstream D: Task statement enrichment

Objective: improve task statements using evidence without leaking the fix.

Allowed enrichments:

- clarify the observed failure mode (from episodic entries)
- name the affected subsystem boundaries (from scope tags)
- mention repo conventions the task touches (from semantic entries)
- note the risk level and tooling context

Disallowed enrichments:

- describing the exact final patch
- naming the implementation tactic so precisely that the task becomes trivial
- including `refs` file paths from the procedural entry (these are the fix)

Acceptance criteria:

- enriched problem statements are more precise
- enriched statements remain valid benchmark prompts
- no `refs` file paths appear in the enriched problem statement

### Workstream E: Consolidation feed export

Objective: ensure benchmark-linked entries can influence nugget generation.

For each task with diary links, export:

- `task_id`
- `linked_entry.id`
- `related_entry_ids[]`
- `family`
- `subsystems[]`
- `importance_signal` (max importance across all linked/related entries)
- `evidence_types[]`

The output should be usable later to:

- include those entries in consolidation batches
- upweight those entries during compilation
- trace a nugget back to the tasks it helped with

Acceptance criteria:

- one stable artifact maps tasks to all evidence entry IDs
- future context tooling can consume it without reading raw git history

### Workstream F: Observation loop specification

Objective: define the future steady-state loop.

Recommended loop:

1. agent/session writes observation into diary (episodic entry)
2. fix lands in git
3. commit includes `MoltNet-Diary:` trailer when available
4. harvesting scans new commits (`npx tsx tasksmith/harvest.ts`)
5. derive generates task records (`npx tsx tasksmith/derive.ts`)
6. enrichment resolves linked entries + discovers related entries
   (`npx tsx tasksmith/enrich.ts`)
7. verification validates tasks (`npx tsx tasksmith/verify.ts`)
8. benchmark-linked entries are exported for consolidation upweighting

Current automation level: manual CLI commands. No webhooks, no scheduled runs.

Future automation candidates:

- git post-commit hook to append diary trailer when entry exists
- CI job to run harvest + derive + enrich on main branch pushes
- consolidation pipeline that reads benchmark-links.json for upweighting

Acceptance criteria:

- one short written workflow (this section)
- no need yet for webhook or fully automated scheduling

## Data model

### Task enrichment (attached to task record)

```json
{
  "task_id": "...",
  "linked_entry": {
    "id": "...",
    "entry_type": "procedural",
    "title": "Accountable commit: ...",
    "tags": ["accountable-commit", "scope:auth"],
    "risk_level": "medium",
    "refs": ["libs/auth/src/index.ts", "..."],
    "summary": "Export RelationshipReader, add testcontainers deps..."
  },
  "related_entries": [
    {
      "id": "...",
      "entry_type": "semantic",
      "title": "architecture:libs-auth — ...",
      "relation": "same_scope",
      "relevance_signal": "scope:auth"
    }
  ],
  "evidence": {
    "failure_patterns": ["Authorization bypass in fetchEntriesStep..."],
    "repo_conventions": ["MUST keep keto-constants.ts in sync with OPL..."],
    "decisions": ["Ed25519 chosen for deterministic signatures..."],
    "workarounds": [],
    "verification_hints": [],
    "nugget_tags": ["scope:auth", "scope:crypto"]
  }
}
```

Keep this orthogonal to verifier data.

### Evidence cache record

```json
{
  "entry_id": "...",
  "title": "...",
  "entry_type": "procedural",
  "tags": ["accountable-commit", "scope:auth"],
  "importance": 5,
  "signed": false,
  "created_at": "2026-03-06T09:32:07.940Z",
  "content_excerpt": "first 500 chars...",
  "resolution_status": "resolved",
  "metadata": {
    "operator": "edouard",
    "tool": "claude",
    "risk_level": "medium",
    "branch": "feat/relationship-reader-diary-list-fix",
    "scopes": ["auth"],
    "refs": ["libs/auth/src/index.ts", "libs/auth/vitest.config.ts"],
    "files_changed": 5
  }
}
```

### Benchmark links

```json
{
  "generated_at": "2026-03-10T...",
  "links": [
    {
      "task_id": "...",
      "linked_entry_id": "...",
      "related_entry_ids": ["..."],
      "family": "auth-permissions",
      "subsystems": ["libs/auth"],
      "importance_signal": 7,
      "evidence_types": ["failure_pattern", "repo_convention", "decision"]
    }
  ]
}
```

## How enrichment should influence nuggets later

### 1. Selection

Entries linked to verified tasks should be easier to include in consolidation
and compilation, because they are proven relevant to benchmarkable work.

Related entries (especially episodic incidents and semantic decisions) should
be upweighted proportionally to the importance of the tasks they support.

### 2. Structuring

Evidence types map naturally to nugget shapes:

- `repo_convention` → rule nugget
- `failure_pattern` → pitfall nugget
- `decision` → constraint nugget
- `workaround` → procedure nugget
- `verification_hint` → checklist nugget

## What not to do

- do not use diary entries alone to define whether a task is valid
- do not treat every trailer-linked commit as benchmark-worthy
- do not let enrichment leak the exact gold fix into the task prompt
- do not block harvesting on full evidence extraction
- do not include `refs` file paths in enriched problem statements
- do not include bulk scan entries (low-importance `source:scan`) as evidence
  unless they contain specific constraints or anti-patterns

Harvesting should still function when there is no diary link.

## Acceptance criteria

This plan is successful when:

- trailer-linked tasks resolve to structured `linked_entry` records
- related episodic/semantic entries are discovered for ≥50% of linked tasks
- enriched task records exist for the diary-linked subset
- evidence is typed and categorized, not raw content
- there is a stable artifact mapping benchmark tasks to all evidence entry IDs
- the repo has a clear written observation → task → nugget loop

## Risks

- diary entries may be too noisy or too solution-specific
- some commit trailers may point to entries that are not benchmark-relevant
- enrichment may accidentally leak implementation details into task statements
- related entry discovery may surface irrelevant entries from broad scope tags
- semantic search may return low-quality matches

Mitigations:

- type evidence instead of pasting raw content
- separate task validity from evidence quality
- keep enrichment additive and reviewable
- cap related entries per task and prefer episodic over bulk semantic
- record discovery signals so noisy sources can be filtered later

## Recommended agent split

### Agent A

Owns:

- procedural entry resolution (Workstream A)
- `<metadata>` parsing
- evidence cache schema and writing

### Agent B

Owns:

- related entry discovery (Workstream B)
- branch/scope/content search strategies
- deduplication and relevance ranking

### Agent C

Owns:

- evidence extraction (Workstream C)
- enriched task statement generation (Workstream D)
- solution-leak review

### Agent D

Owns:

- benchmark-linked entry export (Workstream E)
- observation loop documentation (Workstream F)
