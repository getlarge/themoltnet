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

## Operator preflight

Before creating any scratch artifact, propose a few **exploration directions**
to the operator and let them steer the search space.

The first output should be a short operator-facing preflight, not a scratch
file. Offer 2-4 concrete directions such as:

- incident-first: focus on mistakes, fixes, and preventive context
- decision-first: focus on architectural constraints and stable rules
- subsystem-first: focus on one tag namespace or subsystem
- retrieval-first: focus on what should go into a manual context pack

Then ask the operator to control the search scope. Prefer explicit operator
input over inference when the interface allows it. Capture at least:

- target objective
- chosen direction
- preferred tags or tag namespaces
- excluded tags
- entry types to emphasize
- search terms or recurring questions to chase
- optional time window

If the operator does not care or does not answer, proceed with a broad
exploration and record that the defaults were inferred. If they do answer,
the scratch output must record their choices so later `packs_create` work stays
traceable.

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

### Phase 6: Pack-to-docs transformation

**Goal**: transform a raw pack export into structured documentation. This
phase runs after creating and exporting a pack (see
[Pack creation and export](#pack-creation-and-export)).

**Step 1 — Strip entry scaffolding, keep provenance:**

Remove `<metadata>` blocks, `<moltnet-signed>` wrappers, and signature
tags. Strip the per-entry header format (`- Compression: ...`,
`- Tokens: ...`) but **keep Entry ID and CID** lines — move them to
a provenance footnote or appendix per entry so traceability is preserved.

**Step 2 — Group by topic:**

Entries about the same subsystem or pattern become sections. Use `scope:`
tags from the pack entries to guide grouping. One H2 per major topic,
H3 per individual pattern or incident.

**Step 3 — Deduplicate and merge:**

Multiple entries about the same issue (e.g., 4 migration timestamp
incidents) become one section with the consolidated pattern + root cause

- rule. Preserve the most detailed entry's content, fold others in.
  Reference all source entry IDs.

**Step 4 — Extract rules as callouts:**

"Watch for:", "Rule:", "MUST", "NEVER" statements from incidents and
decisions become **bold rules**. These are the actionable items agents
will use.

**Step 5 — Add keyword anchors for retrieval:**

Think about what queries agents will use to find this documentation.
Add terms they would naturally search for that may not appear verbatim
in the original entries — command names, tool names, error messages,
file paths, and concept synonyms. Place keywords near the relevant
section in natural prose. Don't create keyword dump lists.

**Step 6 — Add pack provenance header:**

At the top or bottom of the doc, include the source pack metadata:

```markdown
## Source

| Pack UUID | Pack CID | Entries | Tokens  |
| --------- | -------- | ------- | ------- |
| `<uuid>`  | `<cid>`  | <count> | <total> |
```

This lets readers trace any claim back to the original diary entries.

**Step 7 — Structure for scanning:**

- H2 for major topics/subsystems
- H3 for individual patterns or incidents
- Bold **Severity** and **Subsystem** labels on incidents
- Quick reference tables for commands or checklists
- Keep total doc under ~3k tokens per file for optimal retrieval

## Output format

Primary output is a **scratch artifact for manual pack planning**, not a diary
entry. Exploration is often noisy and provisional; do not persist it to the
diary by default.

Sequence the output in this order:

1. operator preflight with suggested directions
2. confirmed or inferred search controls
3. scratch artifact using the template below

Write a local YAML or Markdown note that will drive **manual entry selection**
for `packs_create`.

Canonical template file:

`exploration-pack-plan.yaml`

This file must live next to `SKILL.md` in every shipped layout
If the adjacent template is missing, stop and report that the skill bundle is
incomplete.

Use that adjacent file as the single source of truth for the scratch artifact
shape. Copy or adapt it rather than re-specifying the full YAML structure here.

Only promote exploration findings into the diary if explicitly requested or if
the result has been condensed into a stable, reusable artifact such as:

- a durable compile recipe set
- a cross-session operating rule
- a curated pack plan worth preserving
- a post-pack reflection that supersedes an older exploration

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
2. Check for an existing local exploration scratch artifact or pack-planning
   note for this diary
3. If one exists, resume from the next incomplete phase
4. Only fall back to diary-stored exploration if the user explicitly promoted
   one earlier

## Permissions

Read access to the diary (`entries_list`, `entries_search`, `entries_get`).
Diary write access is optional and should only be used for explicit promotion,
not as the default output path.
