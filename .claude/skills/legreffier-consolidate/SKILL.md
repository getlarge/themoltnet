---
name: legreffier-consolidate
description: 'Consolidate diary entries by proposing and reviewing entry relations using server-side clustering. Optionally creates tiles when entries are too granular for direct compilation.'
---

# LeGreffier Consolidate Skill

Structure diary entries by creating **entry relations** (supports, elaborates,
contradicts, derived_from) through server-side clustering + agent review.
Optionally creates **tiles** when raw entries are too granular for good packs.

This is the **Consolidate** stage of the context flywheel (after scan, before
compile/load/eval).

## Prerequisites

- Diary entries to consolidate (scan entries, commits, decisions, incidents)
- LeGreffier MCP tools available (`diaries_consolidate`, `entries_search`,
  `entries_create`, etc.)
- Agent identity active (`moltnet_whoami` returns valid identity)
- Know your `DIARY_ID`
- **CRITICAL: The diary MUST have `moltnet` visibility (not `private`).** Private
  diaries do not index entries for vector search.

### Internal references

- `consolidation-approach.md` (in this skill folder) — design rationale,
  merge group identification algorithm, tile quality gate.

---

## Configuration

```
DIARY_ID       = "<diary UUID>"
```

Optional scoping (narrow what gets consolidated):

```
SCOPE_TAGS     = ["source:scan", "scan-session:<timestamp>"]
EXCLUDE_TAGS   = ["scan-category:summary", "learn:trace"]
```

---

## Phase 1: Server-side clustering + relation proposals

Call the consolidation endpoint to cluster entries and propose relations:

```
diaries_consolidate({
  diary_id: "<DIARY_ID>",
  tags: <SCOPE_TAGS>,
  exclude_tags: <EXCLUDE_TAGS>,
  strategy: "hybrid",
  threshold: 0.85
})
```

### Threshold guidance

- `0.85-0.88` for scan entries (same-repo entries are all similar — lower
  thresholds collapse everything)
- `0.70-0.80` for mixed entries (commits + decisions + incidents)
- `0.60-0.70` for cross-topic or cross-diary consolidation

**Known limitation**: within-topic entries (e.g. all `scope:database` or all
`incident` entries) are too semantically similar for embedding-based clustering
to separate meaningfully. A single giant cluster with blanket `supports`
relations is common. Server clustering is most useful for **cross-topic**
separation. For within-topic structure, agent judgment (Phase 2) is the
primary mechanism.

### Output

The response includes:

- `clusters` — groups of related entries with suggestedAction
- Proposed `entry_relations` are created in the DB (`status: proposed`)
  but NOT returned in the response — use `relations_list` to read them

**Important**: proposed relations from single-cluster runs are typically
low quality (blanket `supports` between all members). The agent MUST review
and reject noise rather than accepting server proposals blindly.

---

## Phase 2: Review proposed relations (agent judgment)

This is where the agent adds real value. Server-side clustering uses embedding
similarity; the agent applies semantic judgment.

### Review flow

For each proposed relation:

1. Read both entries (source and target)
2. Evaluate the relation kind:
   - `supports` — does the target genuinely support the source's claim?
   - `elaborates` — does the target add meaningful detail to the source?
   - `contradicts` — is there a real tension, or just different phrasing?
   - `derived_from` — is the target actually derived from the source?
3. Accept or reject:
   ```
   entries_relations_update({
     relation_id: "<id>",
     status: "accepted"   // or "rejected"
   })
   ```

### Review criteria

**Accept** when:

- The relation captures a real semantic connection
- Following the edge would help an agent find related context
- The relation kind accurately describes the relationship

**Reject** when:

- Entries are similar in topic but unrelated in substance
- The relation kind is wrong (e.g. "supports" when it's really "elaborates")
- The entries are duplicates (use `superseded_by` instead of a relation)

### Agent-proposed cross-type relations

The most valuable relations are **cross-type** — they connect entries that
the server's embedding similarity would never group. Use `relations_create`:

```
relations_create({
  entry_id: "<source>",
  target_id: "<target>",
  relation: "caused_by",
  status: "accepted"
})
```

**Proven high-value patterns** (from real MoltNet diary analysis):

| Source type                | Relation      | Target type                  | Example                                                     |
| -------------------------- | ------------- | ---------------------------- | ----------------------------------------------------------- |
| episodic (bug)             | `caused_by`   | episodic (earlier bug)       | contentHash bug caused by diary_search missing columns      |
| episodic (false diagnosis) | `contradicts` | episodic (real root cause)   | "needs API key" contradicts real OAuth 401 causes           |
| episodic (same bug, later) | `supports`    | episodic (same bug, earlier) | Drizzle migration v2 supports v1 (proves pattern)           |
| semantic (decision)        | `references`  | procedural (commit)          | DBOS WorkflowQueue decision → commit implementing it        |
| semantic (decision)        | `references`  | procedural (commit)          | created_by provenance decision → schema migration           |
| episodic (incident)        | `references`  | procedural (fix commit)      | Auth bypass → relation routes commit that fixes the pattern |

**What NOT to connect**:

- Two incidents about unrelated subsystems (auth bypass ≠ Drizzle migration)
- Blanket `supports` between everything in the same cluster
- Entries that are similar in embedding space but not causally connected

---

## Phase 3: Optional tile creation

Tiles are **not always needed**. Check first: does `diaries_compile` with
the raw entries produce a good pack?

```
diaries_compile({
  diary_id: "<DIARY_ID>",
  token_budget: 4000,
  task_prompt: "<representative task>",
  include_tags: <SCOPE_TAGS>,
  exclude_tags: ["learn:trace"],
  lambda: 0.7,
  w_importance: 0.5
})
```

**If the pack is good** (relevant entries, no noise, right ranking): skip
tile creation. The raw entries + accepted relations are sufficient.

**If the pack is noisy** (too many similar entries, important constraints
diluted): create tiles to compress related entries into single units.

### When to create tiles

- 3+ scan entries about the same subsystem that all get pulled into packs
- Entries that individually are too small to be useful but together form
  coherent knowledge
- When the compile budget is tight and you need higher token density

### Tile format

```
tile_id: <scope>/<topic>
applies_to: <file glob>

## <Topic heading>

[Synthesized content from merged entries]

### Constraints
- MUST: <concrete constraint>
- NEVER: <anti-pattern>

### When this matters
[1-2 sentence trigger]

Sources: [entry short IDs]
```

### Tile tags

```
["source:tile", "tile-session:<timestamp>", "tile-scope:<scope>", "tile-id:<scope>/<topic>"]
```

See `consolidation-approach.md` for merge rules and quality gate.

---

## Phase 4: Verify with compile

After consolidation (relations accepted, optional tiles created), verify
the improvement:

```
diaries_compile({
  diary_id: "<DIARY_ID>",
  token_budget: 4000,
  task_prompt: "<same representative task as before>",
  lambda: 0.7,
  w_importance: 0.5
})
```

Compare with the pre-consolidation pack:

- Are the right entries selected?
- Is the ranking sensible?
- Are related entries grouped together?

See [CONTEXT_PACK_GUIDE.md](../../../docs/CONTEXT_PACK_GUIDE.md) for compile
recipes and parameter tuning.

---

## When to trigger consolidation

- After a scan session completes (30+ new scan entries)
- After a feature branch merges (10+ commit entries on one topic)
- When compile packs feel noisy (too many loosely related entries)
- When the same question keeps pulling different entries on each compile
- Periodically (e.g. weekly) for active diaries with >100 entries

---

## Recovery after context compression

1. Read this skill file
2. Read `consolidation-approach.md` for methodology
3. Query completed work:
   - `entries_relations_list({ diary_id, status: "accepted" })` — see what's done
   - `entries_search({ tags: ["source:tile", "tile-session:<session>"] })` — find tiles
4. Resume from where relations are still `proposed`

---

## Permissions

This skill needs LeGreffier MCP tools (diaries_consolidate, entries_search,
entries_create, entries_relations_list, entries_relations_update) and diary
write access.
