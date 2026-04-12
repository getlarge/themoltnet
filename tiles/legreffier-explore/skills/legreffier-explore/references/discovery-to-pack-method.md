# Discovery-to-Pack Method

A repeatable method for mapping a diary's tag structure, cross-referencing
tags against entry types, and defining a pack strategy. Use this reference
alongside the explore skill's phases.

## Two paths to packs

After discovery, there are two distinct paths to creating packs:

### Path 1: Agent-curated packs (recommended)

The agent reads entries, selects the best ones for a topic, and assembles
them via `packs_create` with explicit entry IDs and ranking. This is the
recommended approach because:

- The agent controls exactly what goes in
- Ranking is explicit and traceable
- No dependency on server-side scoring heuristics
- Works well with the explore skill's manual pack plan output

The explore skill's Phase 5 produces **compile recipe suggestions** — these
are blueprints that guide the agent's manual curation, NOT parameters to
feed to a server endpoint. Use them to decide which tags to filter by,
which entry types to emphasize, and what token budget to target. Then
hand-pick entries and call `packs_create`.

### Path 2: Server-side compile (optional, delegation)

`diaries_compile` delegates entry selection to the server's MMR algorithm.
Useful when:

- You want a quick draft without reading every entry
- The diary is too large to curate manually (500+ entries)
- You're exploring what the server would select for a given prompt

The compile recipes in Phase C of this document describe tuning parameters
for this path. **This is not mandatory.** If you already know which entries
belong in the pack, skip compile and go straight to `packs_create`.

---

## Phase A: Tag Landscape Mapping

Use `diary_tags` with prefix filters to discover the tag namespace
efficiently (much faster than paginating `entries_list`).

### Step A.1: Enumerate top-level prefixes

```
diary_tags({ diary_id, prefix: "scope:", min_count: 3 })   → domain scopes
diary_tags({ diary_id, prefix: "source:", min_count: 1 })   → content origin
diary_tags({ diary_id, prefix: "branch:", min_count: 8 })   → active branches
diary_tags({ diary_id, prefix: "risk:", min_count: 1 })     → commit risk levels
diary_tags({ diary_id, prefix: "rejected:", min_count: 1 }) → rejected alternatives
diary_tags({ diary_id, prefix: "scan-category:" })          → scan observation categories
diary_tags({ diary_id, prefix: "scan-session:" })           → batch provenance
```

Do NOT hardcode these prefixes — discover them from `diary_tags({ diary_id })`
first, then drill into each prefix. The list above is an example from a
real diary; yours will differ.

### Step A.2: Identify bare tags (no prefix)

Run `diary_tags({ diary_id, min_count: 5 })` and subtract prefixed tags.
Common bare tags: `decision`, `incident`, `workaround`, `reflection`,
`accountable-commit`, `provenance`, `ci`, `migration`, `database`.

Bare tags are often the most useful for pack construction because
they represent semantic categories that cut across scopes.

### Step A.3: Map the tag hierarchy

Group by purpose:

| Group                     | Tags                                                       | Purpose                           |
| ------------------------- | ---------------------------------------------------------- | --------------------------------- |
| **Domain scope**          | `scope:*`                                                  | What subsystem an entry is about  |
| **Content origin**        | `source:scan`                                              | How the entry was created         |
| **Entry category**        | `decision`, `incident`, `workaround`, `accountable-commit` | What kind of knowledge            |
| **Branch context**        | `branch:*`                                                 | When/where the work happened      |
| **Risk level**            | `risk:low/medium/high`                                     | Commit risk classification        |
| **Rejected alternatives** | `rejected:*`                                               | What was considered and discarded |
| **Session**               | `scan-session:*`                                           | Batch provenance                  |

### Key insight: tags are AND-only in compile

`include_tags` filters by AND — an entry must have ALL specified tags.
This means `include_tags: ["scope:database", "incident"]` gives
database incidents only. To get "database OR incidents", you need
two separate compiles or a custom pack.

**Recommended approach: one tag dimension per pack.** Don't cross
two high-cardinality prefixes in the same include_tags. Instead,
build focused packs and let agents compose them.

## Phase B: Tag x Entry Type Cross-Referencing

Run `diary_tags` with `entry_types` filters to find where content lives.

### Step B.1: Semantic entries (decisions, knowledge)

```
diary_tags({ diary_id, entry_types: ["semantic"], min_count: 2 })
```

Look for: `decision` tag count, `source:scan` count,
scope tags. These are the knowledge backbone.

### Step B.2: Episodic entries (incidents, bugs)

```
diary_tags({ diary_id, entry_types: ["episodic"], min_count: 2 })
```

Look for: `incident` tag count, `workaround` count, scope distribution.
These are the "what went wrong" entries.

### Step B.3: Procedural entries (commits, how-to)

```
diary_tags({ diary_id, entry_types: ["procedural"], prefix: "scope:", min_count: 5 })
```

Look for: scope distribution across commits. High-count scopes
indicate areas with lots of change activity.

### Step B.4: Reflection entries

```
diary_tags({ diary_id, entry_types: ["reflection"] })
```

Usually sparse. Check if any exist — they're valuable for
handoffs and session summaries.

### Step B.5: Build the intersection matrix

| Entry Type | Top Tags      | Count | Pack-worthy?                        |
| ---------- | ------------- | ----- | ----------------------------------- |
| semantic   | `decision`    | ?     | Yes if 10+ — architecture decisions |
| semantic   | `source:scan` | ?     | Yes if 10+ — codebase orientation   |
| episodic   | `incident`    | ?     | Yes if 10+ — pitfalls pack          |
| episodic   | `scope:<X>`   | ?     | Marginal if < 5                     |
| procedural | `scope:<X>`   | ?     | Usually too granular for context    |
| reflection | any           | ?     | Usually too few                     |

**Rule of thumb: a pack needs 5+ entries to be useful, 10+ to be robust.**

Below 5, you get a pack that's either too narrow or too sparse. Above 10,
the compile's MMR diversity kicks in and produces genuinely useful output.

## Phase C: Compile Recipe Tuning (server-side path only)

> **This phase is optional.** It applies only if you choose to delegate
> entry selection to `diaries_compile`. If you're curating entries manually
> via `packs_create` (the recommended path), skip to Phase D.
>
> Even when skipping compile, the parameter guidelines below are useful
> as mental models — they describe what "good" looks like for each pack
> type in terms of diversity vs focus, recency vs timelessness, etc.

### Tuning parameters

| Parameter      | Purpose                                                             | Recommended range                      |
| -------------- | ------------------------------------------------------------------- | -------------------------------------- |
| `lambda`       | Relevance vs diversity (1.0 = pure relevance, 0.0 = pure diversity) | 0.3-0.7                                |
| `w_importance` | Weight for entry importance score                                   | 0.5-0.8                                |
| `w_recency`    | Weight for recency bias                                             | 0 for knowledge, 0.2-0.3 for incidents |
| `token_budget` | Maximum tokens in the pack                                          | 2000-12000 (match to content density)  |
| `task_prompt`  | Relevance anchor for MMR scoring                                    | Specific question about the domain     |

### Parameter guidelines by pack type

**Orientation packs** (scan observations):

- lambda=0.3 (maximize diversity — you want breadth)
- w_importance=0.8, w_recency=0 (timeless knowledge)
- No task_prompt or generic one

**Decision packs** (architecture decisions):

- lambda=0.5 (balance relevance and diversity)
- w_importance=0.8, w_recency=0 (decisions don't expire)
- task_prompt: the domain area

**Incident/pitfall packs** (bugs, workarounds):

- lambda=0.4 (lean toward diversity — show different failure modes)
- w_importance=0.6, w_recency=0.2 (recent incidents more relevant)
- task_prompt: "common pitfalls and bugs in [area]"

**Subsystem-focused packs** (scope:database, scope:api):

- lambda=0.7 (lean toward relevance — stay focused)
- w_importance=0.8, w_recency=0 (or 0.1 if the area changes fast)
- entry_types: ["semantic", "episodic"] (skip procedural noise)
- task_prompt: specific question about the subsystem

### Evaluate compile results

Look at three metrics:

1. **Budget utilization** — how much of the token budget was used.
   Below 50% means the tag filter is too narrow or entries are too few.
   Consider broadening the filter or reducing budget.

2. **Entries included** — how many entries made it into the pack.
   Below 5 is too sparse. Above 20 at full compression suggests
   the filter is too broad.

3. **Compression ratio** — 1.0 means no compression was needed.
   Below 0.9 means some entries were compressed to fit, which
   indicates the budget is tight for the entry count.

**Scan packs need generous budgets.** Scan entries are 500-1000+ tokens
each. At 4000 tokens only ~5 of 13 entries survive at full resolution.
If the scan content is useful, increase the budget to 8000-12000.

## Phase D: Pack Strategy Definition

### Strategy: tag-focused packs, not wide packs

Build packs around one primary tag dimension. Don't try to capture
everything in one pack. Agents can load multiple packs for their task.

### Tier system

**Tier 1: Always-useful packs** (pin these)

- Codebase orientation — `source:scan`, lambda=0.3, generous budget (8000+)
- Architecture decisions — `decision`, semantic only, lambda=0.5, 4000 tokens
- Incident log — `incident`, episodic only, lambda=0.4, 4000 tokens

**Tier 2: Subsystem-focused packs** (build on demand, let expire)

- Per-scope packs — `scope:<X>`, episodic+semantic, lambda=0.7, 3000-4000 tokens

**Tier 3: Specialized packs** (per-session, never pin)

- Rejected alternatives — `rejected:*` via search, semantic only
- Branch context — `branch:feat/X`, all types, lambda=0.5, w_recency=0.3
- Scan by category — `source:scan` + `scan-category:*`, semantic only, lambda=0.3

### Generic method for any diary

1. Run `diary_tags({ diary_id })` to discover the full tag landscape, then
   `diary_tags({ diary_id, min_count: 3 })` to filter out noise
2. Group tags by prefix into dimensions (scope, source, category, etc.)
3. For each dimension with 5+ distinct entries:
   a. Test a compile with the dimension's main tag (or read entries manually)
   b. Evaluate whether the entries are pack-worthy (coherent topic, useful content)
   c. If viable, curate entries via `packs_create` or delegate via `diaries_compile`
4. Document the pack catalog with parameters
5. Pin Tier 1 packs (they're always useful)
6. Build Tier 2 packs on demand (let them expire)
7. Build Tier 3 packs per-session (never pin)

## Tag Hygiene

- **Avoid double-prefix bugs** (`scope:scope:api`) — normalize at write time
- **Use `scope:` consistently** — bare words like `database` and `ci`
  should be `scope:database` and `scope:ci`
- **Tag coverage matters** — if a subsystem has entries but no scope tag,
  those entries won't appear in scope-filtered packs
- **`source:nugget` and `source:tile` are deprecated** — use `source:scan`
  entries as the canonical structured source material
