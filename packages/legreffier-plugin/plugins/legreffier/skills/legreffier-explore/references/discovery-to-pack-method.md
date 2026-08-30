# Discovery-to-Pack Method

A repeatable method for mapping a diary's tag structure, cross-referencing
tags against entry types, and defining a pack strategy. Use this reference
alongside the explore skill's phases.

## Curated packs

The agent reads entries, selects the best ones for a topic, and assembles
them via `packs_create` with explicit entry IDs and ranking. This approach:

- The agent controls exactly what goes in
- Ranking is explicit and traceable
- No dependency on server-side scoring heuristics
- Works well with the explore skill's manual pack plan output

The explore skill's Phase 5 produces **pack recipe suggestions** — these
are blueprints that guide the agent's manual curation, NOT parameters to
feed to a server endpoint. Use them to decide which tags to filter by,
which entry types to emphasize, and what token budget to target. Then
hand-pick entries and call `packs_create`.

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

### Key insight: combine tag filters deliberately

`include_tags` filters by AND — an entry must have ALL specified tags.
This means `include_tags: ["scope:database", "incident"]` gives
database incidents only. To get "database OR incidents", you need
two separate entry searches, whose selected results can be combined in a
custom pack.

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
curate for coverage and remove redundant entries.

## Phase C: Pack Recipe Tuning

Use the guidelines below as mental models for manual curation. They describe
what "good" looks like for each pack type in terms of diversity versus focus
and recency versus timelessness.

### Curation inputs

| Input          | Purpose                                    | Guidance                               |
| -------------- | ------------------------------------------ | -------------------------------------- |
| Entry rank     | Explicit order in `packs_create --entries` | Put foundational evidence first        |
| Importance     | Prioritize consequential entries           | Prefer high-importance decisions       |
| Recency        | Break ties where current behavior matters  | Prefer recent incidents                |
| `token_budget` | Maximum tokens in the pack                 | 2000-12000, matched to content density |
| Task intent    | Question the pack should help answer       | Keep it specific to one domain         |

### Parameter guidelines by pack type

**Orientation packs** (scan observations):

- Maximize breadth and avoid redundant entries
- Prefer important, timeless knowledge
- Cover each major subsystem

**Decision packs** (architecture decisions):

- Balance domain relevance and coverage
- Prefer high-importance decisions
- Include rejected alternatives when they explain current constraints

**Incident/pitfall packs** (bugs, workarounds):

- Include different failure modes rather than repeated symptoms
- Prefer recent incidents when behavior changes quickly
- Preserve the workaround and root cause together

**Subsystem-focused packs** (`scope:database`, `scope:api`):

- Stay focused on one subsystem
- Prefer semantic and episodic entries over procedural noise
- Include current constraints and representative incidents

### Evaluate the selected pack

Look at two metrics:

1. **Budget utilization** — how much of the token budget was used.
   Below 50% means the tag filter is too narrow or entries are too few.
   Consider broadening the filter or reducing budget.

2. **Entries included** — how many entries made it into the pack.
   Below 5 is too sparse. Above 20 at full compression suggests
   the filter is too broad.

**Scan packs need generous budgets.** Scan entries are 500-1000+ tokens
each. If the scan content is useful, use a budget around 8000-12000 and keep
the entry selection explicit.

## Phase D: Pack Strategy Definition

### Strategy: tag-focused packs, not wide packs

Build packs around one primary tag dimension. Don't try to capture
everything in one pack. Agents can load multiple packs for their task.

### Tier system

**Tier 1: Always-useful packs** (pin these)

- Codebase orientation — `source:scan`, broad coverage, generous budget (8000+)
- Architecture decisions — `decision`, semantic only, 4000 tokens
- Incident log — `incident`, episodic only, 4000 tokens

**Tier 2: Subsystem-focused packs** (build on demand, let expire)

- Per-scope packs — `scope:<X>`, episodic+semantic, 3000-4000 tokens

**Tier 3: Specialized packs** (per-session, never pin)

- Rejected alternatives — `rejected:*` via search, semantic only
- Branch context — `branch:feat/X`, all types, recent work first
- Scan by category — `source:scan` + `scan-category:*`, semantic only

### Generic method for any diary

1. Run `diary_tags({ diary_id })` to discover the full tag landscape, then
   `diary_tags({ diary_id, min_count: 3 })` to filter out noise
2. Group tags by prefix into dimensions (scope, source, category, etc.)
3. For each dimension with 5+ distinct entries:
   a. Read entries matching the dimension's main tag
   b. Evaluate whether the entries are pack-worthy (coherent topic, useful content)
   c. If viable, curate entries via `packs_create`
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
