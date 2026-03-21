# Diary Exploration Findings — 2026-03-20

Systematic exploration of the `themoltnet` diary (6e4d9948) to discover
patterns, anti-patterns, and compile recipes for context packs.

## Diary Inventory

| Category             | Count | Entry types          | Key tags                                              |
| -------------------- | ----- | -------------------- | ----------------------------------------------------- |
| Scan observations    | 30    | semantic, reflection | `source:scan`, `scan-category:*`, `scan-batch:*`      |
| Tiles                | 20    | semantic             | `source:tile`, `tile-id:*`, `tile-scope:*`            |
| Nuggets (deprecated) | 5     | semantic             | `source:nugget`, `nugget-domain:*`                    |
| Decisions            | ~15   | semantic             | `decision`, `scope:*`                                 |
| Accountable commits  | ~74   | procedural           | `accountable-commit`, `risk:*`, `scope:*`, `branch:*` |
| Incidents/bugs       | ~17   | episodic             | `incident`, various scopes                            |
| Learn traces         | 16    | semantic             | `learn:trace`, `learn:agent:*`                        |
| Reflections          | ~3    | reflection           | Various                                               |
| Identity             | 2     | identity, soul       | `system`                                              |

## Tag Namespace Hierarchy

```
source:scan
  scan-category:{architecture,security,workflow,testing,plan,caveat,summary}
  scan-batch:{phase1-b1..b6, phase2-tier0, phase2-tier1, phase2-tier2}

source:tile
  tile-id:{apps/rest-api, crypto/service, diary/service, ...} (20 distinct)
  tile-scope:{apps, libs, cmd, database, diary, crypto, embedding, ...}

source:nugget (DEPRECATED — was created from compile output, no longer recommended)
  nugget-domain:{architecture, database, workflow, security, testing}

decision (no source: prefix)
  scope:{tasksmith, cli, context-evals, diary-service, provenance, ...}

accountable-commit
  risk:{low, medium, high}
  scope:{api, database, tools, evals, tasksmith, web, ...}
  branch:feat/* or branch:fix/*

incident
  scope:* (same namespace as accountable-commit)

learn:trace
  learn:agent:legreffier-local
```

## Compile Recipes (Validated)

### Recipe 1: Conventions for a subsystem

```
include_tags: ["source:scan"]
task_prompt: specific question about the subsystem
lambda: 0.8, w_importance: 0.8, w_recency: 0
```

Result: 4-6 dense entries. Best for "how do I do X correctly?"
Tested: REST API route → pulled rest-api scan, models scan, summary.

### Recipe 2: Understanding decisions

```
task_prompt: the domain area
lambda: 0.8, w_importance: 0.8, w_recency: 0
# no include_tags — decisions live outside source:scan
```

Result: 10-15 entries mixing decisions + tiles + incidents.
Tested: crypto/signing → Ed25519 decision (rank 1), tiles, bug fixes.

### Recipe 3: Distilled tiles

```
include_tags: ["source:tile"]
task_prompt: the domain
lambda: 0.5, w_importance: 0.8
```

Result: 3-8 tile entries. Compact subsystem summaries (~200-400 tokens each).
Note: `source:nugget` entries are deprecated (were created from compile output
via old legreffier-consolidate flow). Use tiles instead — they carry the same
constraints in a more maintainable form.

### Recipe 4: Debugging context

```
entry_types filter would help here (not yet a compile param)
task_prompt: the subsystem + "error" or "bug"
lambda: 0.6, w_importance: 0.5, w_recency: 0.3
exclude_tags: ["learn:trace"]
```

Result: mixed procedural + episodic + semantic. Good for "what went wrong?"

### Recipe 5: Minimal orientation (new agent)

```
include_tags: ["source:scan", "scan-category:summary"]
+ include_tags: ["source:scan", "scan-category:workflow"]
```

Note: compile only supports one include_tags array (AND), not OR across
tag groups. This recipe requires two compiles or a custom pack.

## Agent Mistakes Found (Top Candidates for Task Harvest)

### Critical

1. **Authorization bypass in consolidate** (ad53dfac)
   Agent dropped `diaryId` scope when fixing a silent truncation bug.
   Used if/else-if branching where AND was required.
   Context needed: "repository methods with tenant scope must always AND both filters"

2. **contentHash not computed for unsigned entries** (b8d81343)
   CID computation gated behind `if (signingRequestId)`.
   Broke the entire pack CID pipeline downstream.
   Context needed: "contentHash is a fingerprint, not a signing gate"

3. **diary_search() missing columns** (f715c662)
   SQL RETURNS TABLE out of sync with schema.
   Context needed: "when adding a column, update diary_search() too"

### High

4. **Eval runner score=0 — 3 root causes** (94ecbadc)
   CLAUDECODE env var, hooks, OAuth token contamination.
   Context needed: subprocess environment hygiene rules.

5. **Missed OpenAPI + Go client regen** (b415f618)
   Changed TypeBox schemas, forgot the 3-command chain.
   Context needed: "any schema change → openapi → TS client → Go client"

6. **Drizzle migration journal non-monotonic** (f7a8312f, 84cd7164)
   Future-dated entries in journal break new migration timestamps.
   Happened 3 times across different branches.

### Medium

7. **False diagnosis: assumed SDK needs API key** (cdc2cbc8)
   Agent hallucinated instead of searching diary for known root causes.

8. **@themoltnet/legreffier published with private deps** (2e99af04)
   Workspace deps in `dependencies` instead of `devDependencies`.

9. **Unsigned entries violating signing policy** (ae1c9760)
   Used `entries_create` directly, bypassing signing workflow.

## Anti-Patterns Found

### Tagging

- **`scope:scope:api`** double-prefix in 4+ entries — tag normalization bug
  in the accountable commit workflow
- **`scope:misc`** used once — uninformative, should be specific
- **Two old-style decision entries** use bare words (`diary-service`,
  `provenance`) without `scope:` prefix — predates structured metadata
- **Missing `branch:` tag** on 2 entries

### Entries

- **`learn:trace` entries are 75% noise** for context packs:
  - No codeContext in 12/16 traces
  - Same question repeated 7 times (vouch) and 3 times (e2e tests)
  - Q&A JSON format, not declarative knowledge
  - Poor answers propagate through learning chains
  - **Recommendation**: `exclude_tags: ["learn:trace"]` as project default

### Commits (from procedural analysis)

- **Codex produces broader commits** (15-20 files mixing UI + API + codegen)
  vs Claude (typically 1-8 files, single concern)
- **One planning commit written as accountable-commit** — future tense,
  describes planned scope not committed result
- **Regeneration commits are well-isolated** (good pattern) — always standalone

## Coverage Gaps

| Domain                           | Gap                              | Source                            |
| -------------------------------- | -------------------------------- | --------------------------------- |
| Vouch system                     | No dedicated semantic entry      | learn:trace failures (7 attempts) |
| E2E test config                  | Not in diary, only in CLAUDE.md  | learn:trace failures (3 attempts) |
| libs/auth plugin code            | No tile (only auth/secrets tile) | Tile coverage analysis            |
| `pnpm generate:openapi` workflow | Not in diary                     | OpenAPI learn:trace score gap     |
| Entry type filtering in compile  | Not supported as param           | Recipe 4 limitation               |

## Gaps in Tooling

1. **No tag discovery endpoint** — filed as #454
2. **No custom pack creation route** — `custom` packType exists in schema
   but no `POST /packs` or equivalent. Tracked loosely in #396 Phase 3.
3. **No entry_types filter in compile** — can filter by tags but not entry type
4. **Compile only supports AND for include_tags** — can't compose
   "tiles OR nuggets" in one call; requires two compiles or custom pack
5. **No pack diff** — can't compare two packs to see what changed

## Consolidation Experiment Results (2026-03-21)

Ran 4 consolidation experiments to test clustering quality and relation proposals.

### Universal finding: single mega-cluster

| Experiment                | Entries | Clusters | Threshold | Similarity |
| ------------------------- | ------- | -------- | --------- | ---------- |
| Incidents only            | 20      | 1        | 0.75      | 0.854      |
| Two branches (procedural) | 14      | 1        | 0.82/0.90 | 0.914      |
| Scan + decisions          | 16      | 1        | 0.78      | 0.876      |
| Database-scoped           | 28      | 1        | 0.80      | 0.885      |

The e5-small-v2 embeddings (384-dim) place all MoltNet entries in a dense
region. Same-repo entries are always >0.85 cosine similar regardless of
entry type, subsystem, or branch.

### Consolidation limitations discovered

1. **Only `supports` proposed** — `clusterToRelationProposals` generates
   only `supports` from representative→members. No `caused_by`, `elaborates`,
   `contradicts`, `references` are ever auto-proposed.

2. **Direction is inverted** — highest-importance entry becomes source:
   "principle supports incident" when semantically it should be "incident
   elaborates principle"

3. **Relations accumulate** — multiple consolidation runs add duplicate
   `supports` to the same entries. No cross-workflow dedup.

4. **Threshold cannot separate** — even at 0.90, two different branches
   (compile-pack-persistence + issue-396-pack-routes) collapsed into one
   cluster (internal similarity 0.914). Separation needs >0.95.

### Recommendations for consolidation usage

- **Pre-filter by tag** before consolidating — don't mix all entries
- **Skip server clustering** for within-topic entries — go straight to
  agent-proposed relations
- **Use consolidation for cross-topic separation** only when entries span
  genuinely different domains (not yet tested — needs entries from
  multiple repos or very different subsystems)
- **Always agent-review** — never accept server proposals blindly
- **Agent creates the valuable relations** — specific kinds, correct
  direction, cross-type connections

## Next Steps

- Create dedicated entries for coverage gaps (vouch, e2e config, auth plugin)
- Fix `scope:scope:*` double-prefix bug in accountable commit workflow
- Build explore-and-compose script once #454 (tags endpoint) lands
- Add entry_types filter to compile API
- Implement custom pack creation endpoint (#456)
- Improve `clusterToRelationProposals` to propose varied relation kinds
- Add cross-workflow dedup for proposed relations
- Consider upgrading embedding model for better intra-domain separation
