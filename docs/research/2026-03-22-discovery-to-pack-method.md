# Discovery-to-Pack Method — 2026-03-22

A repeatable method for exploring a diary's tag structure and defining
context pack creation strategies. Tested against the `themoltnet` diary
(6e4d9948, 265 tags, ~300 entries).

> **Last validated:** 2026-03-22. Tag counts and recipe results are
> point-in-time snapshots. Re-run `diary_tags` to get current numbers.

## Overview

The method has 4 phases:

```
1. Tag landscape mapping
2. Tag × entry type cross-referencing
3. Compile recipe testing
4. Pack strategy definition
```

## Phase 1: Tag Landscape Mapping

Use `diary_tags` with prefix filters to discover the tag namespace.

### Step 1.1: Enumerate top-level prefixes

```
diary_tags(prefix: "scope:", min_count: 3)   → domain scopes
diary_tags(prefix: "source:", min_count: 1)   → content origin
diary_tags(prefix: "branch:", min_count: 8)   → active branches
diary_tags(prefix: "risk:", min_count: 1)     → commit risk levels
diary_tags(prefix: "learn:", min_count: 1)    → learning traces
diary_tags(prefix: "rejected:", min_count: 1) → rejected alternatives
diary_tags(prefix: "scan-category:")          → scan observation categories
diary_tags(prefix: "tile-id:")                → tile identifiers
diary_tags(prefix: "tile-scope:")             → tile scope groups
```

### Step 1.2: Identify bare tags (no prefix)

Run `diary_tags(min_count: 5)` and subtract prefixed tags.
Common bare tags: `decision`, `incident`, `workaround`, `reflection`,
`accountable-commit`, `provenance`, `ci`, `migration`, `database`.

Bare tags are often the most useful for pack construction because
they represent semantic categories that cut across scopes.

### Step 1.3: Map the tag hierarchy

Group by purpose:

| Group                     | Tags                                                          | Purpose                           |
| ------------------------- | ------------------------------------------------------------- | --------------------------------- |
| **Domain scope**          | `scope:*`                                                     | What subsystem an entry is about  |
| **Content origin**        | `source:scan` (`source:tile`, `source:nugget` are deprecated) | How the entry was created         |
| **Entry category**        | `decision`, `incident`, `workaround`, `accountable-commit`    | What kind of knowledge            |
| **Branch context**        | `branch:*`                                                    | When/where the work happened      |
| **Risk level**            | `risk:low/medium/high`                                        | Commit risk classification        |
| **Rejected alternatives** | `rejected:*`                                                  | What was considered and discarded |
| **Learning**              | `learn:trace`, `learn:agent:*`                                | Agent learning traces             |
| **Session**               | `scan-session:*`                                              | Batch provenance                  |

### Key insight: tags are AND-only in compile

`include_tags` filters by AND — an entry must have ALL specified tags.
This means `include_tags: ["scope:database", "incident"]` gives
database incidents only. To get "database OR incidents", you need
two separate compiles or a custom pack.

**Recommended approach: one tag dimension per pack.** Don't cross
two high-cardinality prefixes in the same include_tags. Instead,
build focused packs and let agents compose them.

## Phase 2: Tag × Entry Type Cross-Referencing

Run `diary_tags` with `entry_types` filters to find where content lives.

### Step 2.1: Semantic entries (decisions, knowledge)

```
diary_tags(entry_types: ["semantic"], min_count: 2)
```

Look for: `decision` tag count, `source:scan` count,
scope tags. These are your knowledge backbone.

### Step 2.2: Episodic entries (incidents, bugs)

```
diary_tags(entry_types: ["episodic"], min_count: 2)
```

Look for: `incident` tag count, `workaround` count, scope distribution.
These are your "what went wrong" entries.

### Step 2.3: Procedural entries (commits, how-to)

```
diary_tags(entry_types: ["procedural"], prefix: "scope:", min_count: 5)
```

Look for: scope distribution across commits. High-count scopes
indicate areas with lots of change activity.

### Step 2.4: Reflection entries

```
diary_tags(entry_types: ["reflection"])
```

Usually sparse. Check if any exist — they're valuable for
handoffs and session summaries.

### Step 2.5: Build the intersection matrix

| Entry Type | Top Tags         | Count | Pack-worthy?                           |
| ---------- | ---------------- | ----- | -------------------------------------- |
| semantic   | `decision`       | 27    | Yes — architecture decisions pack      |
| semantic   | `source:tile`    | 23    | Deprecated — use `source:scan` instead |
| semantic   | `source:scan`    | 30    | Yes — codebase orientation pack        |
| episodic   | `incident`       | 24    | Yes — pitfalls pack                    |
| episodic   | `scope:database` | 7     | Marginal — too few for standalone      |
| procedural | `scope:tools`    | 34    | No — too granular for context          |
| reflection | any              | 2     | No — too few                           |

**Rule of thumb: a pack needs 5+ entries to be useful, 10+ to be robust.**

Below 5, you get a pack that's either too narrow (missing important
context) or too sparse (wasted token budget). Above 10, the compile's
MMR diversity kicks in and produces genuinely useful ranked output.

## Phase 3: Compile Recipe Testing

Test the most promising tag × entry_type combinations with actual
`diaries_compile` calls.

### Tuning parameters

| Parameter      | Purpose                                                             | Recommended range                      |
| -------------- | ------------------------------------------------------------------- | -------------------------------------- |
| `lambda`       | Relevance vs diversity (1.0 = pure relevance, 0.0 = pure diversity) | 0.3–0.7                                |
| `w_importance` | Weight for entry importance score                                   | 0.5–0.8                                |
| `w_recency`    | Weight for recency bias                                             | 0 for knowledge, 0.2–0.3 for incidents |
| `token_budget` | Maximum tokens in the pack                                          | 2000–12000 (match to content density)  |
| `task_prompt`  | Relevance anchor for MMR scoring                                    | Specific question about the domain     |

### Parameter guidelines by pack type

**Orientation packs** (scan observations):

- λ=0.3 (maximize diversity — you want breadth)
- w_importance=0.8 (surface important entries)
- w_recency=0 (timeless knowledge)
- No task_prompt or generic one

**Decision packs** (architecture decisions):

- λ=0.5 (balance relevance and diversity)
- w_importance=0.8 (decisions are ranked by importance)
- w_recency=0 (decisions don't expire)
- task_prompt: the domain area

**Incident/pitfall packs** (bugs, workarounds):

- λ=0.4 (lean toward diversity — show different failure modes)
- w_importance=0.6 (moderate — some low-importance incidents are still useful)
- w_recency=0.2 (recent incidents are more relevant)
- task_prompt: "common pitfalls and bugs in [area]"

**Subsystem-focused packs** (scope:database, scope:api):

- λ=0.7 (lean toward relevance — stay focused)
- w_importance=0.8 (surface the important stuff)
- w_recency=0 (or 0.1 if the area changes fast)
- entry_types: ["semantic", "episodic"] (skip procedural noise)
- task_prompt: specific question about the subsystem

### Evaluate results

Look at three metrics:

1. **Budget utilization** — how much of the token budget was used.
   Below 50% means the tag filter is too narrow or there aren't
   enough entries. Consider broadening the filter or reducing budget.

2. **Entries included** — how many entries made it into the pack.
   Below 5 is too sparse. Above 20 at full compression suggests
   the filter is too broad.

3. **Compression ratio** — 1.0 means no compression was needed.
   Below 0.9 means some entries were compressed to fit, which
   indicates the budget is tight for the entry count.

### Validated recipes (themoltnet diary)

| Recipe                 | include_tags                                 | entry_types        | λ   | w_imp | w_rec | Budget | Result                                         |
| ---------------------- | -------------------------------------------- | ------------------ | --- | ----- | ----- | ------ | ---------------------------------------------- |
| Database pitfalls      | `scope:database`                             | episodic, semantic | 0.7 | 0.8   | 0     | 4000   | 11 entries, 57% util                           |
| Architecture decisions | `decision`                                   | semantic           | 0.5 | 0.8   | 0     | 4000   | 17 entries, 99.8% util                         |
| Incident log           | `incident`                                   | episodic           | 0.4 | 0.6   | 0.2   | 4000   | 20 entries, 99.7% util                         |
| All scans              | `source:scan`                                | semantic           | 0.3 | 0.8   | 0     | 4000   | 13 entries (5 full, 8 compressed), 99.6% util  |
| Architecture scans     | `source:scan` + `scan-category:architecture` | semantic           | 0.3 | 0.8   | 0     | 3000   | 14 entries (4 full, 10 compressed), 99.6% util |
| Phase2-tier0 scans     | `source:scan` + `scan-batch:phase2-tier0`    | semantic           | 0.3 | 0.8   | 0     | 2000   | 10 entries (2 full, 8 compressed), 99.9% util  |
| Provenance             | `scope:provenance`                           | episodic, semantic | 0.7 | 0.7   | 0     | 3000   | 3 entries, 17.6% util                          |

**Scan packs need generous budgets.** Scan entries are 500-1000+ tokens each.
At 4000 tokens only 5 of 13 entries survive at full resolution. If the scan
content is useful (and it usually is), increase the budget to 8000-12000.

**Failed recipe: provenance** — only 3 entries matched because
provenance knowledge lives across multiple scope tags. The `scope:provenance`
tag is under-applied. Fix: either re-tag relevant entries or don't make a
standalone provenance pack — instead, use task_prompt to pull provenance
entries from a broader scope filter.

**Deprecated: tiles** — `source:tile` entries were a consolidation output
from the old legreffier-consolidate flow. Scan entries (`source:scan`) are
the canonical source material and carry richer content.

## Phase 4: Pack Strategy Definition

Based on Phases 1–3, define a pack catalog for the diary.

### Strategy: tag-focused packs, not wide packs

Build packs around one primary tag dimension. Don't try to capture
everything in one pack. Agents can load multiple packs for their
specific task.

### Recommended pack catalog (themoltnet)

**Tier 1: Always-useful packs**

1. **Codebase orientation** — `source:scan`, λ=0.3, generous budget (8000+)
   - For: new agents starting a session
   - Content: subsystem conventions, architecture patterns, constraints
   - See `docs/recipes/legreffier-scan-flows.md` for how scans are produced

2. **Architecture decisions** — `decision`, semantic only, λ=0.5, 4000 tokens
   - For: agents making design choices
   - Content: past decisions with rationale and rejected alternatives

3. **Incident log** — `incident`, episodic only, λ=0.4, 4000 tokens
   - For: agents before committing changes
   - Content: past bugs, security issues, workarounds

**Tier 2: Subsystem-focused packs (build on demand)**

4. **Database subsystem** — `scope:database`, episodic+semantic, λ=0.7, 4000 tokens
5. **API subsystem** — `scope:api`, episodic+semantic, λ=0.7, 4000 tokens
6. **CLI subsystem** — `scope:cli`, episodic+semantic, λ=0.7, 3000 tokens
7. **Auth/crypto** — `scope:auth` or `scope:crypto`, semantic, λ=0.7, 3000 tokens

**Tier 3: Specialized packs**

8. **Rejected alternatives** — `rejected:*` via search, semantic only
   - For: agents considering approaches already tried and discarded
   - Build as custom pack from search results

9. **Branch context** — `branch:feat/X`, all types, λ=0.5
   - For: agents resuming work on a specific branch
   - w_recency=0.3 to surface recent commits

10. **Scan by category** — `source:scan` + `scan-category:*`, semantic only, λ=0.3
    - For: focused codebase analysis on a specific dimension
    - Narrow with `scan-category:architecture`, `scan-category:security`, etc.

### Generic method for any diary

1. Run `diary_tags()` to discover the full tag landscape, then
   `diary_tags(min_count: 3)` to filter out noise
2. Group tags by prefix into dimensions (scope, source, category, etc.)
3. For each dimension with 5+ distinct entries:
   a. Test a compile with the dimension's main tag
   b. Evaluate budget utilization and entry count
   c. If util > 50% and entries > 5, it's a viable pack
4. Document the pack catalog with parameters
5. Pin Tier 1 packs (they're always useful)
6. Build Tier 2 packs on demand (let them expire)
7. Build Tier 3 packs per-session (never pin)

### Tag hygiene recommendations

- **Avoid double-prefix bugs** (`scope:scope:api`) — normalize at write time
- **Use `scope:` consistently** — bare words like `database` and `ci`
  should be `scope:database` and `scope:ci`
- **Tag coverage matters** — if a subsystem has entries but no scope tag,
  those entries won't appear in scope-filtered packs
- **`learn:trace` entries are experimental** — produced by an unpublished
  ax-learn exploration. Exclude if present and not useful for the task.
- **`source:nugget` and `source:tile` are deprecated** — use `source:scan`
  entries as the canonical structured source material

## Open Questions

### Consolidation quality (known limitation)

Server-side consolidation (clustering → relation proposals) doesn't
work well for within-topic entries. The e5-small-v2 embeddings
produce >0.85 cosine similarity for all same-repo entries regardless
of subsystem or entry type. Possible improvements:

- Upgrade embedding model (e5-large, or a different architecture)
- Use tag-based pre-clustering instead of embedding-based
- Add metadata features (entry type, tags, temporal distance) to the
  similarity computation
- Skip server clustering entirely and go agent-proposed-relations-only

This is an open research question. See `docs/research/2026-03-20-diary-exploration-findings.md`
§ Consolidation Experiment Results for the full data.

### OR-composition for tags

The compile API only supports AND for include_tags. To build a pack
that combines "tiles OR decisions", you need two compiles or a custom
pack. The recommended approach is: build separate focused packs and
let agents compose them. OR-support is lower priority than good
single-dimension packs.

### Scan entry staleness

Scan observations can become outdated as the codebase evolves. The compile
workflow already excludes entries with `supersedes` relations
(`excludeSuperseded: true` is hardcoded). However, the legreffier-scan
skill does not currently create `supersedes` relations when re-scanning
a subsystem that was already scanned. This means old and new scan entries
coexist without linkage.

Possible approaches:

- Re-scan skill creates `supersedes` relations from new to old scan entries
  with matching `scan-category` or subsystem tags
- Manual supersession: agent creates relations after reviewing both versions
- Temporal filtering: use `created_after` to only include recent scans

This is an important gap for long-lived diaries where the codebase changes
significantly between scan sessions.

### Temporal packs

For fast-moving projects, packs filtered by `created_after` could
provide "what happened this week" context. The compile API supports
`created_after` and `created_before` — worth testing but not explored
in this round.

## Appendix: Tag Taxonomy (themoltnet, 2026-03-22)

### By entry type

| Type       | Entries | Top Tags                                                |
| ---------- | ------- | ------------------------------------------------------- |
| procedural | ~182    | `accountable-commit`, `risk:*`, `scope:*`, `branch:*`   |
| semantic   | ~95     | `source:scan` (30), `decision` (27), `source:tile` (23) |
| episodic   | ~24     | `incident` (24), `workaround` (8), `scope:database` (7) |
| reflection | ~3      | `reflection` (2), `source:scorecard` (1)                |
| identity   | 2       | `system`                                                |

### By prefix (top 5)

| Prefix     | Distinct Tags | Total Uses |
| ---------- | ------------- | ---------- |
| `scope:*`  | 30            | ~450       |
| `branch:*` | 30+           | ~200       |
| `tile-*`   | 37            | ~85        |
| `learn:*`  | 36            | ~60        |
| `scan-*`   | 10+           | ~75        |
