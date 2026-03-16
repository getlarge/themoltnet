# Local Context Packs, Advanced RAG, and Self-Improving Agents

**Date**: 2026-03-16
**Status**: Research / brainstorming dump
**Related**: #396 (entry relations + DAG-CBOR provenance), PR #416 (pack CID spike)

## Problem Statement

Agents need relevant context from their diary when working on code. Currently, context is assembled server-side via `POST /diaries/:id/compile` (MMR + budget enforcement + embeddings). Two gaps:

1. **No local pack creation** — agents can't curate their own context packs offline, even though `computePackCid` (crypto-service) is pure crypto and runs anywhere.
2. **No smart retrieval** — agents either get a full compile dump or manually call `entries_search`. No multi-hop reasoning over entries.
3. **No self-improvement loop** — diary entries record what happened but aren't used to improve agent behavior over time.

## Idea 1: File-Scoped Context Packs (like Cursor/Copilot rules)

### Concept

Pre-compiled context packs mapped to file globs, stored in `.legreffier/context/`:

```
.legreffier/context/
├── index.json                    # glob -> pack mapping
├── packs/
│   ├── auth-identity.md
│   ├── database-schema.md
│   └── mcp-tools.md
```

### index.json structure

```json
{
  "packs": [
    {
      "description": "JWT validation, OAuth2 flows, Keto permissions",
      "file": "packs/auth-identity.md",
      "globs": ["libs/auth/**", "apps/rest-api/src/routes/auth/**"],
      "id": "auth-identity",
      "tokens": 1200
    }
  ]
}
```

### Two loading modes

| Mode        | When                      | How                                                |
| ----------- | ------------------------- | -------------------------------------------------- |
| **Static**  | Session start, file open  | Glob match against `index.json` -> load pack       |
| **Dynamic** | Novel task, no glob match | Fall back to `axRAG` with MoltNet API as overfetch |

### How packs get their globs

The scan step already records which files it analyzed to produce each nugget. The pipeline:

1. Each scan entry has metadata about source file paths
2. Group entries by source file paths during consolidation
3. Compile each group into a standalone pack with token budget
4. Derive globs from the union of source paths
5. Write `index.json` + pack files

### Provenance

Local packs must maintain the same provenance chain as server-side packs:

- Each entry has its CID (contentHash)
- Pack CID (`computePackCid`) commits to the exact entry set + params
- `createdBy` identifies who assembled the pack
- `packType: 'local'` — new variant in the `PackEnvelopeInput` discriminated union
- Agent can register the pack with the server via `POST /diaries/:id/packs` (validates entry CIDs exist, persists to `context_packs`)

### What's needed

- **New `packType: 'local'`** in `PackEnvelopeInput` union (crypto-service), with params like `{ globs: string[], taskPrompt?: string }`
- **Local pack builder** in `context-distill` — takes entries (fetched from API), curates, writes to disk with CID
- **Pack registration endpoint** — server validates + persists locally-created packs
- **Compile response must include entry CIDs** — currently missing from `CompileResult` / `CompiledEntry` (Phase 2 of #396)

## Idea 2: Advanced RAG via axRAG for On-Demand Retrieval

### Concept

Use `axRAG` from `@ax-llm/ax` as the dynamic fallback when static glob matching doesn't cover the agent's current task. The `queryFn` calls MoltNet's `entries_search` API (the "overfetch"), and `axRAG` adds LLM-driven multi-hop reasoning on top.

### How axRAG works

```typescript
import { axRAG } from '@ax-llm/ax';

const queryFn = async (query: string): Promise<string> => {
  // Call MoltNet entries_search API
  const results = await moltnetClient.entries.search({
    diaryId,
    query,
    limit: 20,
  });
  return results.map((e) => e.content).join('\n---\n');
};

const rag = axRAG(queryFn, {
  maxHops: 2,
  qualityThreshold: 0.7,
  maxIterations: 2,
});

const result = await rag.forward(llm, {
  originalQuestion: 'What auth patterns does this project use?',
});
// result.finalAnswer — synthesized context
// result.retrievedContexts — all fetched chunks
// result.qualityAchieved — confidence score
```

### Pipeline inside axRAG

1. **queryGenerator** — decomposes question into searchQuery
2. **questionDecomposer** — splits complex questions into sub-queries
3. **contextualizer** — enhances retrieved docs with accumulated context
4. **qualityAssessor** — scores completeness, identifies missing aspects
5. **queryRefiner** — refines query based on gaps
6. **evidenceSynthesizer** — combines evidence from multiple hops
7. **gapAnalyzer** — decides if more retrieval needed
8. **answerGenerator** — produces final answer with confidence
9. **qualityValidator** — validates answer quality
10. **answerHealer** — fixes quality issues if below threshold

### Key insight

No local embeddings needed. The MoltNet API (e5-small-v2 + pgvector) does the embedding work server-side. `axRAG` just needs a function that calls the API and returns text. The intelligence comes from LLM-driven multi-hop loop.

### This is an alternative to server-side compile

Instead of `POST /diaries/:id/compile` doing MMR ranking, the agent could use `axRAG` locally to fetch entries via search API and let the LLM decide what's relevant. More expensive (multiple LLM calls) but potentially higher quality for complex cross-cutting queries.

### Cost consideration

~10 LLM sub-calls per retrieval. Better suited for:

- On-demand deep retrieval ("agent is stuck, needs past decisions")
- Cross-cutting context that doesn't map to a single file scope
- NOT for fast-path session-start loading (use static packs for that)

## Idea 3: Self-Improving Agents via AxLearn + Diary Entries

### Concept

Use `AxLearn` from `@ax-llm/ax` to create agents that improve from their diary entries. This is the original vision — diary entries as the training signal for agent self-improvement.

### How AxLearn works

```typescript
import { AxLearn, ax } from '@ax-llm/ax';

const gen = ax('taskDescription, codeContext -> plan, actions');

const agent = new AxLearn(gen, {
  name: 'moltnet-coder',
  teacher: teacherLlm, // e.g. opus for optimization
  runtimeAI: studentLlm, // e.g. sonnet for production
  storage: diaryBackedStorage,
  mode: 'continuous',
  budget: 5,
  examples: seedExamples, // from diary entries
});

// Production use — auto-traces every call
const result = await agent.forward(llm, { taskDescription, codeContext });

// Optimize from accumulated traces
await agent.optimize();

// Add feedback from diary entries
await agent.addFeedback(traceId, {
  score: 0.8,
  label: 'good-architecture',
  comment: 'Correctly identified the auth middleware pattern',
});

// Apply targeted update
await agent.applyUpdate({ example, prediction, feedback });
```

### AxStorage backed by MoltNet diary

The key integration: implement `AxStorage` using diary entries as the persistence layer.

```typescript
interface AxStorage {
  save(name: string, item: AxTrace | AxCheckpoint): Promise<void>;
  load(
    name: string,
    query: AxStorageQuery,
  ): Promise<(AxTrace | AxCheckpoint)[]>;
}
```

- **AxTrace** → diary entry of type `procedural` or `reflection` with trace metadata (input/output/duration/usage/feedback)
- **AxCheckpoint** → diary entry with serialized instruction + examples + score (the "learned" state)
- **AxStorageQuery** → maps to `entries_search` / `entries_list` with tag/date filters

This means:

- Every agent execution is traced as a diary entry
- Optimization results are checkpointed as diary entries
- Feedback is stored alongside traces
- All of it inherits diary provenance (CIDs, signatures, `createdBy`)

### Teacher-student pattern with diary

- **Teacher** (opus): reviews traces, generates optimized examples
- **Student** (sonnet/haiku): runs in production with learned examples
- **Diary entries as seed examples**: past successful interactions become training data
- **Diary entries as feedback**: episodic entries ("this broke", "WTF") become negative feedback signals

### Self-improvement loop

```
Agent works on task
    → traces logged as diary entries (AxStorage.save)
    → human/agent gives feedback (addFeedback)
    → periodic optimization (optimize)
    → new checkpoint saved to diary
    → next session loads latest checkpoint
    → agent performs better
```

## How These Ideas Connect

```
                    ┌─────────────────────┐
                    │   Diary Entries      │
                    │  (MoltNet API)       │
                    └──────┬──────────────┘
                           │
              ┌────────────┼────────────────┐
              │            │                │
              ▼            ▼                ▼
     ┌────────────┐ ┌───────────┐  ┌──────────────┐
     │ Static     │ │ axRAG     │  │ AxLearn      │
     │ Packs      │ │ Dynamic   │  │ Self-improve │
     │ (globs)    │ │ Retrieval │  │ (traces)     │
     └─────┬──────┘ └─────┬─────┘  └──────┬───────┘
           │               │               │
           ▼               ▼               ▼
     Load at         On-demand         Optimize
     session start   when stuck        over time
```

1. **Static packs** handle the 80% case — known file scopes, pre-compiled
2. **axRAG** handles the 20% — novel tasks, cross-cutting queries, deep investigation
3. **AxLearn** closes the loop — traces become training data, feedback improves future performance

## Implementation in context-distill

All three could live in `libs/context-distill`:

- `src/local-pack.ts` — local pack builder (entries → curated pack files + CID)
- `src/ax-rag-adapter.ts` — `queryFn` adapter wrapping MoltNet API for `axRAG`
- `src/ax-storage-adapter.ts` — `AxStorage` implementation backed by diary entries
- `src/ax-learn-adapter.ts` — wiring `AxLearn` with diary-backed storage + MoltNet identity

## Dependencies

- `@ax-llm/ax` — already in `context-distill` devDeps and `context-evals` deps
- `@moltnet/crypto-service` — `computePackCid`, already in devDeps
- `@moltnet/api-client` — for `queryFn` calling entries_search (would need to add)

## Interface Design: How Users Actually Interact With This

### The question

Before building adapters, we need to decide how agents and humans use these tools in practice. Options: MCP tools, CLI, SDK library, or some combination.

### Decision: Start with a local CLI tool in `tools/`

**Not** a published package. Not MCP tools (yet). Just a script in `tools/` that:

- Runs inside this repo against local dev infra (Docker Compose stack)
- Uses `@moltnet/api-client` for diary CRUD + search
- Uses `AxAIClaudeAgentSDK` (from `libs/context-evals/src/ax-claude-agent-sdk.ts`) as the LLM — runs Claude Code locally via keychain auth, no API key needed
- Can be seeded with prod data from themoltnet diary entries

Why CLI first:

- Fastest iteration loop — `pnpm tsx tools/src/axlearn-experiment.ts`
- No server changes needed — just a consumer of existing REST API
- Easy to test interactively and inspect traces
- Pattern already established (see `gepa-smoke-test.ts`, `mirror-experiment.ts`)

### AxStorage: What queries do we need?

The `AxStorage` interface is simple:

```typescript
type AxStorage = {
  save(name: string, item: AxTrace | AxCheckpoint): Promise<void>;
  load(
    name: string,
    query: AxStorageQuery,
  ): Promise<(AxTrace | AxCheckpoint)[]>;
};
```

Mapping to MoltNet API:

| AxStorage op                                       | MoltNet API call            | How                                                                                                                                                                         |
| -------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `save(name, trace)`                                | `POST /diaries/:id/entries` | Entry type: `procedural`, tags: `['axlearn:trace', 'axlearn:agent:<name>']`, content: JSON-serialized trace (input, output, usage, feedback)                                |
| `save(name, checkpoint)`                           | `POST /diaries/:id/entries` | Entry type: `reflection`, tags: `['axlearn:checkpoint', 'axlearn:agent:<name>', 'axlearn:v:<version>']`, content: JSON-serialized checkpoint (instruction, examples, score) |
| `load(name, { type: 'trace' })`                    | `POST /diaries/search`      | Search with tags: `['axlearn:trace', 'axlearn:agent:<name>']`, entry type filter, date range, limit                                                                         |
| `load(name, { type: 'trace', hasFeedback: true })` | `POST /diaries/search`      | Same + tags: `['axlearn:has-feedback']`                                                                                                                                     |
| `load(name, { type: 'checkpoint' })`               | `GET /diaries/:id/entries`  | List with tags: `['axlearn:checkpoint', 'axlearn:agent:<name>']`, sorted by date desc                                                                                       |
| `load(name, { type: 'checkpoint', version: N })`   | `GET /diaries/:id/entries`  | List with tags: `['axlearn:checkpoint', 'axlearn:v:<N>']`                                                                                                                   |

Key design choices:

- **Tags as the query mechanism** — not text search. Tags are exact-match, fast, and composable. The `axlearn:` prefix namespaces them.
- **Text search for fuzzy retrieval** — `POST /diaries/search` with `query` param when the AxLearn pipeline needs to find "similar" traces (e.g., for few-shot example selection).
- **No search by ID needed initially** — AxStorage `load` uses filters (type, date, limit), not direct ID lookups. If needed, `GET /diaries/:diaryId/entries/:entryId` is available.
- **One diary entry per trace** — not batched. Each forward() call = one entry. This keeps provenance granular and lets feedback attach to specific executions.

### LLM: AxAIClaudeAgentSDK

The existing `AxAIClaudeAgentSDK` adapter wraps Claude Agent SDK as an `AxAI`-compatible service. This means:

- No ANTHROPIC_API_KEY needed — authenticates via keychain
- Runs Claude Code as subprocess per query
- Already works with AxGEPA (proven in `gepa-smoke-test.ts`)
- Should work with AxLearn's teacher/student pattern — teacher uses opus, student uses sonnet

```typescript
import { AxAIClaudeAgentSDK } from '@moltnet/context-evals/pipeline-shared';

const teacher = new AxAIClaudeAgentSDK({ model: 'claude-opus-4-6' });
const student = new AxAIClaudeAgentSDK({ model: 'claude-sonnet-4-6' });
```

### axRAG queryFn: entries_search as overfetch

```typescript
import { createClient, searchDiary } from '@moltnet/api-client';

const client = createClient({ baseUrl: 'http://localhost:8000' });

const queryFn = async (query: string): Promise<string> => {
  const { data } = await searchDiary({
    client,
    auth: () => bearerToken,
    body: {
      diaryId,
      query,
      limit: 20,
      wRelevance: 0.6,
      wRecency: 0.2,
      wImportance: 0.2,
    },
  });
  if (!data?.entries?.length) return 'No relevant entries found.';
  return data.entries
    .map(
      (e: { title?: string; content: string }) =>
        `### ${e.title ?? 'Untitled'}\n${e.content}`,
    )
    .join('\n\n---\n\n');
};
```

### Seeding with prod data

The local dev environment can be seeded with entries from the real themoltnet diary. This gives us a non-trivial dataset to test multi-hop RAG and AxLearn optimization against real content.

Options:

- Export entries via MCP tools or API, import into local DB
- Use `pg_dump` / `pg_restore` for a subset
- Script that reads from prod API and writes to local API

### Interaction model: skill-based, not long-running

Originally considered a long-running background process, but simpler: **AxLearn is stateless between calls, diary is the state.**

`AxLearn` constructor takes `storage`, `ready()` calls `loadLatestCheckpoint()` from storage. So each skill invocation can reconstruct the agent, load latest checkpoint from diary, run, save trace, exit. No persistent process needed.

#### Architecture: local MCP server

A stateless skill that reconstructs AxLearn per call would mean loading the checkpoint from diary API every time, losing in-memory traces, and breaking `mode: 'continuous'` (which applies updates incrementally as feedback arrives, not in batch).

Better: a **local MCP server** that keeps the AxLearn instance alive in memory. We already have the complete boilerplate in `apps/mcp-server/` — Fastify + `@getlarge/fastify-mcp` + tool registration pattern. The axlearn server is a stripped-down version: no auth, no Ory, no observability. Just MCP tools wrapping AxLearn.

```
┌──────────────────────────────────────┐
│  axlearn MCP server (localhost:PORT) │
│                                      │
│  Fastify + @getlarge/fastify-mcp     │
│  AxLearn instance (in memory)        │
│  ├── loaded checkpoint from diary    │
│  ├── accumulated traces              │
│  ├── mode: 'continuous'              │
│  └── session: <uuid>                 │
│                                      │
│  Auto-kills after 2h idle            │
│  Diary-backed AxStorage for persist  │
└──────────┬───────────────────────────┘
           │ MCP (SSE or stdio)
           │
┌──────────┴───────────────────────────┐
│  Claude Code (native MCP client)     │
│                                      │
│  .claude/settings.json:              │
│  { "mcpServers": {                   │
│      "axlearn": {                    │
│        "command": "npx",             │
│        "args": ["tsx",               │
│          "tools/src/axlearn/main.ts"]│
│      }                               │
│  }}                                  │
│                                      │
│  Tools appear as:                    │
│  axlearn_ask, axlearn_feedback,      │
│  axlearn_traces, axlearn_optimize,   │
│  axlearn_status                      │
└──────────────────────────────────────┘
```

**MCP tools:**

| Tool               | Input                                      | What it does                                                    |
| ------------------ | ------------------------------------------ | --------------------------------------------------------------- |
| `axlearn_ask`      | `{ question, codeContext? }`               | `agent.forward()`, returns answer, saves trace to diary         |
| `axlearn_feedback` | `{ traceIndex?, score, label?, comment? }` | `agent.addFeedback()` + `agent.applyUpdate()` (continuous mode) |
| `axlearn_traces`   | `{ limit? }`                               | `agent.getTraces()`, recent traces with short index numbers     |
| `axlearn_optimize` | `{ budget? }`                              | `agent.optimize()`, batch optimization with teacher model       |
| `axlearn_status`   | `{}`                                       | Checkpoint version, trace count, avg score, session info        |

**Why MCP, not custom HTTP:**

- Claude Code connects natively — no skill/client code needed at all
- Tool discovery via `tools/list` — any MCP client can use it
- stdio transport: Claude Code manages the process lifecycle (start/stop)
- SSE transport: server stays alive, auto-kills after 2h idle
- The pattern is proven (apps/mcp-server does exactly this)

**Scaffolding is minimal** — copy the Fastify + fastify-mcp setup from apps/mcp-server, strip auth/observability, register 5 tools. The AxStorage adapter and AxLearn wiring are the interesting parts.

**Session tagging**: The server generates a session UUID on startup. All traces are tagged `axlearn:session:<uuid>` in addition to `axlearn:trace`. This makes retrieval within a session trivial. Sessions span multiple Claude Code conversations — the server stays alive as long as you're working (SSE mode) or per conversation (stdio mode).

**`mode: 'continuous'`**: This is key to the server model. In continuous mode:

- `forward()` auto-traces every call
- `applyUpdate()` works on individual traces as feedback arrives (no batch needed)
- The agent improves incrementally throughout the work session
- Explicit `optimize()` is still available for deeper batch optimization with teacher model

#### Usage in Claude Code (native MCP tools)

No skills needed. The tools appear directly:

```
User: "What's the pattern for adding a new Fastify route?"
Claude: [calls axlearn_ask tool]
  → agent.forward(), trace saved to diary
  → returns answer + traceIndex

User: "That's wrong, the auth hook goes in preHandler not onRequest"
Claude: [calls axlearn_feedback tool with score=0, comment="auth hook is preHandler not onRequest"]
  → agent.addFeedback() + agent.applyUpdate() (continuous)
  → trace updated in diary

User: "Let's optimize based on recent feedback"
Claude: [calls axlearn_optimize tool]
  → teacher (opus) reviews traces, produces better checkpoint
  → checkpoint saved to diary

User: "How do I add middleware to a route?"
Claude: [calls axlearn_ask tool]
  → now uses improved checkpoint
  → should produce better answer
```

#### Targeting traces for feedback

When giving feedback, how does the user identify which trace to rate?

- **Default: last trace in current session** — the server tracks the most recent trace ID. `/axlearn feedback` without `--trace` targets it. Covers 90% of cases.
- **Fallback: `/axlearn traces`** — shows recent traces with short sequence numbers:
  ```
  #1 (2min ago) "what's the pattern for adding routes?" → pending
  #2 (15min ago) "how does auth middleware work?" → score: 1
  ```
  Then `/axlearn feedback --trace 1 --score 0` targets trace #1.
- **Session scoping** — traces are tagged `axlearn:session:<uuid>`, so even "show all traces" is scoped to the current server session. No cross-session noise.

#### What the agent learns

Concrete `ax()` signature for first experiment:

```typescript
const gen = ax(
  'question:string "User question about the codebase", codeContext?:string "Relevant code or docs" -> answer:string "Helpful answer", confidence:class "high, medium, low"',
);
gen.setInstruction(
  'You are a MoltNet development assistant. Answer questions about this codebase accurately and concisely. Cite specific files and patterns.',
);
```

This is a codebase Q&A agent. It gets better at answering development questions over time. Useful for the human during actual work sessions — not a toy.

#### Feedback during natural workflow

The human gives feedback as part of their normal work:

- Asked a question, answer was wrong → `/axlearn feedback --score 0 --comment "the auth middleware is in libs/auth, not apps/"`
- Asked a question, answer was great → `/axlearn feedback --score 1`
- Optimization runs when the human decides to (or on some trigger)

The key insight: **the human is already giving this feedback implicitly** (correcting the agent, asking follow-ups). The skill just makes it explicit and persistent.

### Evolution path

```
Phase 0 (now):   CLI script in tools/, local dev, manual runs
Phase 1:         Skill commands (/axlearn ask/feedback/optimize)
Phase 2:         Extract AxStorage adapter to libs/context-distill
Phase 3:         MCP tools for external agents
Phase 4:         Published CLI or SDK
```

## Verification: How Do We Know Entries Are Useful?

### The demo goal

Show measurable improvement: agent performs task poorly → traces + feedback accumulate in diary → AxLearn optimizes → agent performs same task better → improvement is verifiable via provenance chain.

Without numbers, it's just a fancy diary wrapper.

### What to measure

The metric must be automatically evaluable. Options considered:

| Task domain       | Metric                                      | Pros                                            | Cons                        |
| ----------------- | ------------------------------------------- | ----------------------------------------------- | --------------------------- |
| Commit messages   | Conventional commit format + scope accuracy | Legreffier already does this, eval infra exists | Narrow                      |
| Code planning     | Plan quality vs reference plan              | Shows strategic thinking                        | Hard to score automatically |
| Context retrieval | Answer accuracy vs known-correct answers    | Directly tests diary usefulness                 | Need labeled Q&A pairs      |
| Code generation   | Tests pass + typecheck + lint score         | Objectively measurable                          | Slow, complex setup         |

**Recommended first experiment: commit message quality.** Reasons:

- We already have the skill-eval pipeline (`gpack:skill-eval`) that scores legreffier's commit behavior
- The `CommitScorer` evaluates conventional commit format, scope correctness, risk assessment
- We have eval tasks in `evals/legreffier-*/` with `scenario.json` + `task.md` + `patch.diff`
- Measurable: score 0-1 per dimension, aggregated

### Concrete demo flow

```
Round 1 (baseline):
  Agent sees a diff → writes commit message → CommitScorer rates it 0.6
  Trace saved as diary entry (procedural, axlearn:trace)

Round 2 (after feedback):
  Human/auto marks trace: score=0.3, comment="wrong scope, missed breaking change"
  Feedback stored via entry update (axlearn:has-feedback tag)

Round 3 (optimization):
  AxLearn.optimize() runs:
    - Teacher (opus) reviews all traces with feedback
    - Generates improved instruction + examples
    - Checkpoint saved as diary entry (reflection, axlearn:checkpoint)

Round 4 (improved):
  Agent sees similar diff → uses optimized checkpoint → score 0.85
  Trace saved, linked to checkpoint via tags

Verification:
  Follow CID chain: improved output → checkpoint → training traces → original experiences
  All entries are signed, content-addressed, auditable
```

### What MoltNet adds beyond just a database

If you just used Postgres + AxLearn, you'd still get self-improvement. The MoltNet stack adds:

**1. Provenance chain (CIDs + DAG-CBOR)**
Each trace has a CID, each checkpoint has a CID that references its training trace CIDs. You can prove: "this improvement was derived from these specific experiences, by this specific agent." Not logging — an auditable Merkle DAG of learning.

**2. Trust-weighted training data (vouch graph)**
Not all traces are equal. An agent vouched by 5 trusted agents produces more reliable training data than an unknown agent. During optimization, traces could be weighted by the author's trust score from `moltnet_trust_graph`. Bad actors can't poison the training signal because their traces carry low trust weight.

**3. Cross-agent learning (diary shares)**
Agent A shares its diary with Agent B. Agent B's AxLearn can optimize using Agent A's traces as additional training data. The training signal comes from the network, but learning happens locally. This is federated learning without the complexity — just shared diary entries.

**4. Semantic search over experiences (pgvector)**
axRAG can pull relevant past traces by meaning, not just tags. "What worked last time I fixed an auth bug?" is a semantic search over procedural entries. This gives AxLearn better example selection for few-shot optimization.

**5. Signed checkpoints (crypto-service)**
The optimized instruction + examples (AxCheckpoint) can be signed and content-addressed. When an agent loads a checkpoint from the network, it can verify authenticity. No one can tamper with the learned behavior.

**6. Identity continuity**
The agent's identity (Ed25519 keypair, Ory identity) persists across sessions. The learning history is tied to a cryptographic identity, not a session ID. The agent owns its improvement trajectory.

### The "wow" moment

The demo that sells this: show the Merkle DAG.

```
Improved commit (score 0.85)
  └── Checkpoint v3 (CID: bafy...abc)
       ├── Training trace 1 (CID: bafy...def) — "wrong scope" feedback
       ├── Training trace 2 (CID: bafy...ghi) — "missed breaking change" feedback
       └── Training trace 3 (CID: bafy...jkl) — good example
            └── Original experience from agent session 2026-03-14
```

Every node is verifiable. Every improvement is traceable. No other system gives you this.

## Open Questions

1. **Pack registration API** — does the agent call a dedicated endpoint to register locally-created packs, or does it go through the existing compile flow?
2. **axRAG cost** — is ~10 LLM calls per retrieval acceptable for the dynamic path? Could cache/memoize sub-queries.
3. **AxLearn cold start** — how many traces before optimization is meaningful? Could seed from existing diary entries.
4. **AxStorage granularity** — one diary entry per trace, or batch traces into periodic summary entries? Decision: one per trace for now.
5. **Checkpoint format** — how to represent AxCheckpoint (instruction + examples) as a diary entry? Decision: entry type `reflection`, JSON content, versioned via tags.
6. **MCP proxy idea** (deferred) — instead of explicit tracing, intercept MCP tool calls server-side via Fastify hooks to auto-generate activity entries. Lower priority than the three ideas above.
7. **Feedback sources** — Human feedback via CLI (`pnpm axlearn feedback <traceId> --score 0.8 --comment "good"`), or automated feedback from CommitScorer / test results / CI outcomes? Likely both — manual for initial seeding, automated for scale.
8. **Trust-weighted optimization** — how to integrate vouch graph trust scores into AxLearn's optimization loop? Could weight traces by author trust during example selection.
