# Targeted Context Pack Eval — Experiment Design

**Date**: 2026-03-23
**Status**: In progress
**Scope**: Prove that context packs improve task outcomes, then validate the GEPA optimization loop

## Hypothesis

Context packs containing relevant architectural knowledge help agents solve coding tasks better than agents working without context. Additionally, context packs may allow weaker (cheaper) models to match stronger models' baseline performance.

## Approach

### What we're proving

1. **Context packs improve scores** — targeted packs with relevant knowledge beat empty-context baselines
2. **Model robustness** — haiku + pack ≈ sonnet baseline (5-6x cost reduction)
3. **The eval pipeline works end-to-end** — gpack baseline, gpack with pack, scoring, traces

### What we're NOT proving (yet)

- That diary harvesting produces the right entries automatically
- That `diaries_compile` finds the best entries for a task
- That GEPA optimization converges to better packs

Those come after we prove the fundamentals work.

## Task selection

Selected 3 tasks where diary knowledge should clearly help:

| Task       | Subsystem     | Family  | FTP/PTP | Why pack helps                                                                                                                                                 |
| ---------- | ------------- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pr-216-1` | diary-service | feature | 4/1     | Agent needs to know the embedding pipeline (where `embedPassage()` is called, how tags are structured) — domain-specific knowledge not obvious from code alone |
| `pr-208-1` | auth          | feature | 1/2     | Pattern-following: add `relationshipWriter` to plugin that already decorates `tokenValidator` + `permissionChecker`. Pack provides the exact template          |
| `pr-291-1` | mcp-server    | feature | 4/3     | Convention-following: add diary list/create/get MCP tools matching existing tool patterns. Also requires e2e test updates, docs, and landing page tool count   |

### Selection criteria

- **Strong diary coverage** for the task's subsystem (8+ entries)
- **Knowledge-dependent** — the task requires understanding patterns/conventions that aren't self-evident from just reading the immediate code
- **Measurable delta** — the baseline should be low enough that improvement is visible

### Tasks we rejected

| Task                             | Why skipped                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pr-189-0` (recovery 404→400)    | Simple HTTP status change. Baseline failure was a regression (broke something else), not knowledge gap |
| `pr-230-0` (signing payload fix) | Low-level encoding bug. Fix is in test vectors, not architectural knowledge                            |

## Pack construction method

### Philosophy

We are NOT testing whether `diaries_compile` finds the right entries. We are testing whether **the right context, when provided, improves outcomes**.

If the right entry doesn't exist in the diary yet — we create it first. This is honest: we're proving the pipeline works, not the harvesting.

### Steps per task

1. **Search diary** for existing entries matching the task's subsystem and topic
2. **Assess gaps** — is the knowledge the agent needs actually in those entries?
3. **Create missing entries** if needed — write semantic entries with the architectural knowledge that would help (conventions, patterns, API contracts)
4. **Build pack** — use `packs_create` (custom pack API) or `diaries_compile` with tight tag filters to assemble a focused pack
5. **Export pack** — `moltnet pack export <id> --out packs/<task-id>.md`
6. **Review pack** — read the markdown, verify it contains relevant context without answer leakage

### Entry types for pack construction

| What to include          | Entry type | Example                                                                                                      |
| ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------ |
| Architectural patterns   | `semantic` | "Auth plugin decoration pattern: each service is registered via `fastify.decorate()` with type augmentation" |
| Conventions              | `semantic` | "MCP tools follow naming convention: `<domain>_<action>`. Each tool has a schema in `schemas.ts`"            |
| Past incidents           | `episodic` | "When adding new MCP tools, the e2e test `registers tools with correct names` must be updated"               |
| Implementation decisions | `semantic` | "Embedding text is built from content + tags so semantic search respects tag-based filtering"                |

### What NOT to include

- The actual solution code (answer leakage)
- Commit messages from the PR that introduced the fix (temporal leakage)
- Test expectations (gives away the answer)

## Supersession flow — closing the GEPA loop

### The problem

GEPA optimizes the instruction (pack content) and produces a `bestInstruction`. How does that optimized content become a reusable, versioned pack?

### Proposed flow

```
1. GEPA produces bestInstruction (optimized pack content)
      ↓
2. Create a new semantic entry with the optimized content
   - entryType: "semantic"
   - tags: ["source:gepa-optimized", "pack-version:v2", "scope:<subsystem>"]
   - title: "Context pack: <subsystem> — optimized by gpack run <timestamp>"
   - importance: 8
   - Content-signed (CID + signature) for immutability
      ↓
3. Create a pack containing that single entry
   - Use packs_create (custom pack API)
   - Or compile with include_tags: ["pack-version:v2", "scope:<subsystem>"]
      ↓
4. Mark the previous pack entry as superseded
   - Set superseded_by on the old entry pointing to the new one
   - Creates an immutable version chain
      ↓
5. Export the new pack
   - moltnet pack export <new-pack-id> --out packs/<subsystem>-v2.md
   - The file is what agents receive
```

### Version chain

```
v1 (manual, seed pack)
  └── superseded_by → v2 (GEPA-optimized, round 1)
                          └── superseded_by → v3 (GEPA-optimized, round 2)
```

Each version is content-signed (CID), so the chain is cryptographically traceable. The provenance graph API (`packs_provenance`) can walk this chain.

### Entry structure for optimized packs

```markdown
Title: Context pack: auth — gpack optimized v2
Type: semantic
Tags: source:gepa-optimized, pack-version:v2, scope:auth, gpack-run:<timestamp>
Importance: 8

<the optimized instruction/context content from GEPA bestInstruction>
```

### Open question

Should the optimized pack be a single monolithic entry, or should it be decomposed back into multiple entries (one per topic/pattern) for better reuse in future compilations? The monolithic approach is simpler and preserves GEPA's optimization. The decomposed approach enables mixing optimized and non-optimized entries in future packs.

**Current answer**: Start monolithic. Decompose later if needed.

## Test matrix

```
              | No pack (baseline) | With targeted pack |
--------------+--------------------+--------------------+
Sonnet 4.6    |      Run 3 tasks   |     Run 3 tasks    |
Haiku 4.5     |      Run 3 tasks   |     Run 3 tasks    |
--------------+--------------------+--------------------+
Total: 12 runs, ~$1.50, ~30 minutes
```

### Expected outcomes (hunches)

| Task       | Sonnet baseline | Sonnet+pack | Haiku baseline | Haiku+pack |
| ---------- | --------------- | ----------- | -------------- | ---------- |
| `pr-216-1` | 0.20            | 0.80        | 0.00           | 0.60       |
| `pr-208-1` | 0.30            | 0.70        | 0.10           | 0.50       |
| `pr-291-1` | 0.30            | 0.70        | 0.10           | 0.50       |

These are guesses. The point is to have predictions before we run, so we can evaluate whether the results match our model.

### Success criteria

- **Strong signal**: at least 2/3 tasks show >0.3 improvement with pack (sonnet)
- **Model robustness**: haiku+pack within 0.2 of sonnet baseline on at least 1 task
- **Pipeline works**: all 12 runs complete without errors

### Commands

```bash
# Baseline (sonnet, no pack)
pnpm --filter @moltnet/tools gpack --task-id 216-1,208-1,291-1 --task-source tasksmith --baseline --verbose

# With pack (sonnet)
pnpm --filter @moltnet/tools gpack --task-id 216-1 --task-source tasksmith --baseline --verbose --pack-file packs/diary-service.md
pnpm --filter @moltnet/tools gpack --task-id 208-1 --task-source tasksmith --baseline --verbose --pack-file packs/auth.md
pnpm --filter @moltnet/tools gpack --task-id 291-1 --task-source tasksmith --baseline --verbose --pack-file packs/mcp-server.md

# Baseline (haiku, no pack)
pnpm --filter @moltnet/tools gpack --task-id 216-1,208-1,291-1 --task-source tasksmith --baseline --verbose --claude-model claude-haiku-4-5

# With pack (haiku)
pnpm --filter @moltnet/tools gpack --task-id 216-1 --task-source tasksmith --baseline --verbose --claude-model claude-haiku-4-5 --pack-file packs/diary-service.md
# ... etc
```

## Results

_To be filled after runs complete._

| Task       | Sonnet baseline | Sonnet+pack | Haiku baseline | Haiku+pack |
| ---------- | --------------- | ----------- | -------------- | ---------- |
| `pr-216-1` |                 |             |                |            |
| `pr-208-1` |                 |             |                |            |
| `pr-291-1` |                 |             |                |            |

### Observations

_To be filled._

### Conclusions

_To be filled._

## References

- GEPA adapter alignment: https://github.com/getlarge/themoltnet/issues/393#issuecomment-4106333180
- Implementation PR: https://github.com/getlarge/themoltnet/pull/476
- Research doc (GEPA adapter analysis): `docs/research/2026-03-22-gepa-ax-multi-objective-context-evals.md`
- Context pack guide: `docs/CONTEXT_PACK_GUIDE.md`
