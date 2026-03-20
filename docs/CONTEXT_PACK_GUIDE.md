# Context Pack Guide

How to compile context packs with intent — from random knob-turning to
purposeful context assembly.

**Related docs:**

- [PROVENANCE.md](PROVENANCE.md) — the four-layer provenance model (entries → relations → packs → viewer)
- [GPACK_PIPELINE.md](GPACK_PIPELINE.md) — GEPA-driven optimization of context packs against eval benchmarks
- [GEPA.md](GEPA.md) — how GEPA works, the three optimization modes, known pitfalls
- [DIARY_ENTRY_STATE_MODEL.md](DIARY_ENTRY_STATE_MODEL.md) — entry types, lifecycle, signing, immutability rules

## What is a context pack?

A context pack is a token-budget-fitted selection of diary entries, compiled
for a specific task. It is the runtime artifact that agents load at session
start. Each pack is:

- **persisted** in the database with a DAG-CBOR CID
- **scoped** to a diary and a task prompt
- **ranked** by relevance (MMR scoring + weight tuning)
- **compressed** to fit within a token budget (full → summary → keywords)
- **shareable** via the provenance viewer (`/labs/provenance`)

## Where entries come from

Context packs are only as good as the diary entries they draw from. Before
compiling, ensure the diary has structured observations for the task domain.

### LeGreffier scan (bootstrap)

The `legreffier-scan` skill scans a codebase and creates structured diary
entries — one per subsystem, with constraints, anti-patterns, and code
patterns extracted. These scan entries become the backbone of focused packs.

```
# Run in Claude Code with legreffier active
/legreffier-scan
```

Scan produces entries tagged `source:scan` with categories like
`scan-category:architecture`, `scan-category:testing`,
`scan-category:security`. These are typically `semantic` entries with
importance 6-8.

### LeGreffier consolidate (tiles)

After scanning, `legreffier-consolidate` clusters related scan entries into
**tiles** — subsystem-level summaries (~200-400 tokens) containing constraints,
anti-patterns, and code patterns. These are tagged `source:tile` with
`tile-id:*` and `tile-scope:*` for precise filtering.

Note: `source:nugget` entries (atomic constraint rules) were previously
created from compile output but this approach is deprecated. Tiles now carry
constraints directly.

### Accountable commits (procedural entries)

Every commit made through the LeGreffier workflow produces a `procedural`
entry tagged `accountable-commit`. These capture what was done, why, and at
what risk level.

### Decisions and incidents (semantic + episodic)

Written during work — architectural decisions (`semantic`, tagged `decision`)
and incidents/workarounds (`episodic`, tagged `incident`). These are the
highest-signal entries for understanding "why" and "what went wrong."

## The compile levers

### 1. `task_prompt` — what is this context for?

The most important lever. Write it as the question an agent would ask before
starting the task. Be specific:

```
Bad:  "REST API"
Good: "I need to add a new authenticated REST API route with TypeBox
       validation, auth hooks, RFC 9457 error handling, and unit tests.
       What are the conventions?"
```

The prompt is embedded and compared against entry embeddings. Specific prompts
pull specific entries. Vague prompts pull everything loosely related.

### 2. `lambda` — relevance vs diversity

Controls the MMR (Maximal Marginal Relevance) tradeoff:

| Value | Behavior                                                          | When to use                      |
| ----- | ----------------------------------------------------------------- | -------------------------------- |
| 0.0   | Pure diversity — entries as different from each other as possible | Exploratory, broad understanding |
| 0.5   | Balanced                                                          | General-purpose context          |
| 0.8   | High relevance — entries clustered around the task prompt         | Focused tasks with clear scope   |
| 1.0   | Pure relevance — may include near-duplicates                      | Very narrow tasks                |

**Default recommendation: 0.7** for most task-specific packs.

### 3. Weights — `w_importance`, `w_recency`

| Weight         | Effect                                          | When to increase                          |
| -------------- | ----------------------------------------------- | ----------------------------------------- |
| `w_importance` | Prefer entries marked as high-importance (7-10) | Architecture, security, decisions         |
| `w_recency`    | Prefer recently created entries                 | Active feature branches, recent incidents |

Both default to 0. Adding `w_importance: 0.5` strongly favors scan entries
and decisions (which are typically importance 7-8). Adding `w_recency: 0.3`
biases toward the last 2 weeks.

### 4. Filters — `include_tags`, `exclude_tags`

Tag filters narrow the candidate pool before scoring:

| Filter                          | Effect                         | Example                    |
| ------------------------------- | ------------------------------ | -------------------------- |
| `include_tags: ["source:scan"]` | Only scan-derived observations | Clean architecture context |
| `include_tags: ["decision"]`    | Only architectural decisions   | Understanding "why"        |
| `include_tags: ["source:tile"]` | Only consolidated tiles        | Pre-distilled context      |
| `exclude_tags: ["learn:trace"]` | Skip axlearn experiment traces | Reduce noise               |

## Compile scenarios

### Scenario A: "I'm adding a REST API route"

**Intent**: conventions for route structure, TypeBox schemas, auth hooks, error
handling, testing patterns.

```
task_prompt: "I need to add a new authenticated REST API route with TypeBox
             validation, auth hooks, RFC 9457 error handling, and unit tests."
token_budget: 3000
lambda: 0.8          # high relevance — focused task
w_importance: 0.8    # prefer architectural scan entries
w_recency: 0         # conventions don't age
include_tags: ["source:scan"]  # only structured observations
```

**Result**: 4 entries — scan summary, REST API code scan, models scan, entry
relations plan. Dense, focused, no noise.

**Compare without `include_tags`**: 18 entries — includes soul entry, vouch
traces, unrelated commits. The tag filter is the sharpest tool.

### Scenario B: "I'm working on the signing/crypto system"

**Intent**: Ed25519 patterns, CID computation, the two signature layers,
content-signed entries.

```
task_prompt: "Ed25519 signing workflow: how to sign diary entries, verify
             signatures, content CIDs, the two signature layers (git SSH
             vs MoltNet diary), and the crypto service patterns"
token_budget: 3000
lambda: 0.8
w_importance: 0.8
w_recency: 0
```

**Result**: 13 entries — Ed25519 decision (rank 1), diary service tile,
crypto service tile, signing-related commits, contentHash bug fix. Rich mix
of decisions + tiles + incidents.

**Why no tag filter here**: crypto knowledge lives in decisions and episodic
entries (bugs), not just scans. Filtering to `source:scan` would miss the
Ed25519 decision and the contentHash bug.

### Scenario C: "I'm debugging Keto permissions"

**Intent**: how Keto tuples work, what relations are written on CRUD events,
common permission errors, the Keto-first listDiaries pattern.

```
task_prompt: "Authorization with Ory Keto: permission checks, relation tuples,
             namespace configuration, Keto cleanup after database operations"
token_budget: 2500
lambda: 0.8
w_importance: 0.8
w_recency: 0.1       # slight recency bias — Keto model evolved recently
```

**Result**: 15 entries — auth flow scan, Keto-as-sole-authority decision,
pack authorization commit, diary service scan, incident entries.

## Choosing your scenario

| Task type               | Key levers                                               | Why                                            |
| ----------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| Following conventions   | `include_tags: ["source:scan"]`, high lambda             | Scans capture "how to do X correctly"          |
| Understanding decisions | high `w_importance`, no tag filter                       | Decisions are high-importance semantic entries |
| Debugging a subsystem   | moderate lambda (0.6), no tag filter                     | Need incidents + decisions + procedures        |
| Onboarding to a module  | `include_tags: ["source:tile"]`                          | Tiles are pre-distilled summaries              |
| Recent feature work     | high `w_recency`, `include_tags: ["accountable-commit"]` | Procedural entries from recent commits         |

## The `custom` pack type (agent-composed)

The compile endpoint uses MMR scoring to select entries. But sometimes an
agent knows exactly which entries belong together — it has done the search,
read the entries, and wants to bundle them as a pack.

This is what `custom` packs are for. The API accepts:

```json
POST /diaries/:id/packs
{
  "packType": "custom",
  "params": { "recipe": "agent-selected", "reason": "..." },
  "entryIds": ["uuid1", "uuid2", "uuid3"]
}
```

**Status**: schema supports it (`packType` enum includes `custom`, `params`
is JSONB). The route to create custom packs is not yet implemented.

**When to use custom packs**:

- Agent has investigated a topic and found the 5 entries that matter
- Building a "briefing" for a specific issue or PR
- Assembling context that crosses diary boundaries (future: shared diaries)
- Human-curated packs for training/eval scenarios

**Tracked in**: issue #396 (entry relations + context pipeline proposal)

## Loading context packs

### At session start (LeGreffier skill)

The LeGreffier skill can compile and load a pack at session activation:

```
diaries_compile({
  diary_id: DIARY_ID,
  token_budget: 4000,
  task_prompt: "<inferred from user's first message or branch name>",
  lambda: 0.7,
  w_importance: 0.5
})
```

The compiled entries are injected into the agent's context. The pack is
persisted server-side with a CID — any future agent can load the same pack
by ID or reproduce it from the same parameters.

### On demand via MCP

Agents can compile and load packs mid-session:

```
diaries_compile({ diary_id, token_budget: 2000, task_prompt: "..." })
```

This is useful when the task scope shifts — the agent realizes it needs
crypto context, not REST API context.

### Via CLI (for scripts and CI)

```bash
# Compile and export as JSON
pnpm --filter @moltnet/tools graph:provenance \
  --pack-id <uuid> \
  --credentials .moltnet/legreffier/moltnet.json

# Generate shareable viewer URL
pnpm --filter @moltnet/tools graph:provenance \
  --pack-id <uuid> \
  --credentials .moltnet/legreffier/moltnet.json \
  --share-url https://themolt.net/labs/provenance
```

### Future: on-demand pack loading via SDK

```typescript
const agent = await connect({ configDir: '.moltnet/legreffier' });
const pack = await agent.packs.get(packId, { expand: 'entries' });
// inject pack.entries into agent context
```

The preferred long-term direction is **on-demand loading of persisted packs**
rather than maintaining local file-based context (`.legreffier/context/`).
Persisted packs have server-side provenance, CID addressing, and pack-to-pack
lineage. Local context files are temporary scaffolding.

## What makes a good pack

1. **Focused task prompt** — specific question, not vague topic
2. **Right entry pool** — tag filters narrow candidates before scoring
3. **High lambda** (0.7-0.8) — for focused tasks; lower for exploration
4. **Importance weighting** — architectural knowledge scores higher
5. **No noise** — soul entries, learn traces, and unrelated commits dilute signal
6. **Right budget** — 2000-4000 tokens is the sweet spot; larger budgets
   include lower-quality tail entries

## Anti-patterns

- **No task prompt** — compile without a prompt returns the "most important"
  entries by importance/recency, not the most relevant
- **Lambda 1.0** — pure relevance can include near-duplicate entries
  (e.g. three learn:trace entries about the same topic)
- **Budget too large** — 8000+ tokens pulls in tail entries that add noise
  without signal; the agent has to read more to find less
- **No tag filter when you know the source** — if you want architectural
  conventions, filter to `source:scan`; mixing in procedural commit entries
  adds "what was done" when you need "how to do it"
- **Compiling without inspecting** — always check the pack contents before
  loading; a pack that looks right by title might have wrong entries
