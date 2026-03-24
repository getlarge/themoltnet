---
name: legreffier-explore
description: 'Systematic diary exploration: discover tags, entry distribution, coverage gaps, agent mistakes, and compile recipes. Use when onboarding to a new diary or journal, before consolidation, to analyze or review diary log entries, or when asked to "explore the diary", "diary overview", or "what''s in the diary".'
---

# LeGreffier Explore Skill

Systematically explore a diary to understand what's in it, find patterns and
gaps, and recommend compile recipes. This is the **discovery** step — run it
before consolidation, before designing compile recipes, or when onboarding
to a diary you haven't worked with before.

## Agent name resolution

Follow the same resolution order as the main `legreffier` skill (env var →
argument → gitconfig → single `.moltnet/` subdirectory → ask user).
Store as `AGENT_NAME`. All MCP calls use `mcp__<AGENT_NAME>__*`.

## Prerequisites

- LeGreffier MCP tools available (`entries_list`, `entries_search`,
  `diaries_list`, `diaries_get`)
- Agent identity active (`mcp__<AGENT_NAME>__moltnet_whoami`)
- Diary resolved (match repo name via `diaries_list`, or use
  `MOLTNET_DIARY_ID` env var)

## When to trigger

- First time working with a diary or journal (onboarding)
- Before designing compile recipes for a new task domain
- After a batch of work (50+ new entries) to check diary health
- When compile packs feel noisy or incomplete
- When asked to "explore the diary", "diary analysis", "review diary", or "what's in the diary"

## Exploration phases

Run phases in order. Each phase builds on the previous one's findings.
Use subagents for phases 2-4 to keep the primary context clean.

### Phase 1: Inventory

Map what's in the diary by counting entries per tag and entry type.

```
entries_list({ diary_id, limit: 50, offset: 0 })
entries_list({ diary_id, limit: 50, offset: 50 })
// continue until all entries are covered
```

Compute:

1. **Entry type counts**: count per `entryType` value
2. **Tag frequency**: count occurrences of every distinct tag across all entries
3. **Tag namespaces**: group tags by prefix (everything before the first `:`)
   and list distinct values per namespace. Do NOT hardcode expected namespaces —
   discover them from the data.
4. **Importance distribution**: histogram of importance values (1-10)
5. **Temporal range**: earliest and most recent entry dates

Output: inventory table + tag namespace tree (see [Output format](#output-format)).

### Phase 2: Agent mistakes (episodic analysis)

Find incidents that document mistakes agents made — candidates for Task Harvest
eval tasks and entry relations.

```
entries_list({ diary_id, tags: ["incident"], limit: 20 })
entries_search({ diary_id, query: "bug fix workaround error failed",
                 entry_types: ["episodic"], limit: 15 })
```

If no `incident`-tagged entries exist, fall back to:

```
entries_search({ diary_id, query: "what happened root cause fix applied",
                 entry_types: ["episodic"], limit: 20 })
```

For each episodic entry, extract:

| Field              | What to capture                        |
| ------------------ | -------------------------------------- |
| What went wrong    | The mistake or failure                 |
| Root cause         | Why it happened                        |
| Fix applied        | What resolved it                       |
| Preventive context | What knowledge would have prevented it |
| Subsystem          | Infer from tags or content             |
| Severity           | Critical / High / Medium / Low         |

Group by subsystem. Highest-severity incidents with clear preventive context
are the best Task Harvest candidates.

### Phase 3: Commit patterns (procedural analysis)

Understand how agents commit — scope distribution, risk levels, branch patterns.

```
entries_list({ diary_id, limit: 30,
               tags: [<most common procedural tag from Phase 1>] })
```

If no obvious procedural tag exists, use:

```
entries_search({ diary_id, query: "commit",
                 entry_types: ["procedural"], limit: 30 })
```

Analyze:

- **Tag frequency within procedural entries** — which tags appear most
- **Branch groupings** — which branches have the most entries
- **Anti-patterns**: double-prefix tags (e.g. `scope:scope:*`), catch-all
  tags, entries without branch or scope tags, unusually broad entries

### Phase 4: Coverage gaps

Find topics the diary should cover but doesn't.

**If `learn:trace` entries exist** (from AxLearn or similar):

```
entries_list({ diary_id, tags: ["learn:trace"], limit: 20 })
```

Analyze which questions were asked repeatedly and which had no context —
those are coverage gaps.

**If no `learn:trace` entries**: compare the codebase structure against diary
topics. Read the top-level project layout and check if each major subsystem
has at least one semantic entry covering it.

### Phase 5: Compile recipe recommendations

Based on phases 1-4, recommend compile recipes tailored to this specific diary.

For each recipe, specify:

```yaml
name: '<descriptive name>'
intent: '<what task this context supports>'
task_prompt: '<specific question an agent would ask>'
token_budget: <number>
lambda: <0.0-1.0>
w_importance: <0.0-1.0>
w_recency: <0.0-1.0>
include_tags: [<tags>] # optional, use tags discovered in Phase 1
exclude_tags: [<tags>] # optional, noise sources from Phase 4
rationale: '<why these parameters for this diary>'
```

Base recommendations strictly on what the diary actually contains — don't
recommend filtering by `source:tile` if no tiles exist, don't recommend
excluding `learn:trace` if no learn traces exist.

## Output format

Write findings as a diary entry (`entry_type: reflection`) with this structure:

```
# Diary Exploration — <diary-name>

Date: <ISO timestamp>
Entries analyzed: <count>
Temporal range: <earliest> to <most recent>

## Inventory

| Entry type | Count |
|------------|-------|
| ...        | ...   |

## Tag Namespaces

<namespace>:
  - <value>: <count>
(Discovered from data, not hardcoded)

## Agent Mistakes (<count> found)

### Critical/High severity
- <entry title>: <one-line summary + subsystem>

### Medium/Low severity
- ...

## Commit Patterns

- Top tags: <list with counts>
- Branch distribution: <list with counts>
- Anti-patterns: <list if any>

## Coverage Gaps

| Topic | Evidence | Gap type |
|-------|----------|----------|
| ...   | <how discovered> | <description> |

## Noise Sources (recommend excluding from packs)

- <tag or entry pattern>: <why it's noise>

## Recommended Compile Recipes

<yaml blocks per recipe, tailored to this diary>
```

Tags: `["exploration", "diary-health"]`
Importance: 6

## Relation opportunities

After exploration, note promising cross-type relation candidates:

- Incidents that prove scan entry anti-patterns
- Decisions referenced by procedural commits
- Repeated incidents (same bug pattern across branches)

These feed into the `legreffier-consolidate` skill's Phase 2 (agent-proposed
relations).

## Pack creation and export

After exploration, you can create manual packs from curated entries and
export them as markdown for use as Tessl docs tiles.

### Creating a manual pack

Use `packs_create` to assemble entries by topic with explicit ranking:

```
packs_create({
  diary_id: "<diary-uuid>",
  token_budget: 8000,
  params: {
    recipe: "topic-docs",
    taskPrompt: "<topic description>"
  },
  entries: [
    { entry_id: "<uuid>", rank: 1 },
    { entry_id: "<uuid>", rank: 2 },
    ...
  ],
  pinned: false
})
```

Use `packs_list({ diary_id })` to find the pack UUID after creation.

**Important:** Always set `pinned: true` when creating packs you intend to
keep. Unpinned packs are garbage-collected after ~1 week by default. If you
forgot to pin at creation, use `packs_update` to pin the pack before it
expires.

### Exporting a pack

Export the pack as markdown using the CLI:

```bash
npx @themoltnet/cli pack export <pack-uuid>
npx @themoltnet/cli pack export <pack-uuid> --out context-pack.md
```

The export renders each entry with title, content, CID, compression level,
and token counts. This raw export can be reformatted into structured
documentation for a Tessl docs tile.

## Recovery after context compression

1. Read this skill file
2. Check for existing exploration:
   `entries_search({ diary_id, tags: ["exploration"], limit: 1 })`
3. If found, read it and skip completed phases
4. Resume from the next incomplete phase

## Permissions

Read access to the diary (`entries_list`, `entries_search`, `entries_get`).
Write access for the final reflection entry (`entries_create`).
