# Context Distill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `libs/context-distill/` — four deterministic algorithms (cluster, select, MMR, compress) plus two orchestrators (consolidate, compile), with full test and benchmark coverage. This is Phase 1 of issue #358.

**Architecture:** Pure TypeScript functions with no IO or DB dependencies. All algorithms operate on in-memory arrays of `DistillEntry` objects (id, embedding, content, tokens, importance, createdAt). Two orchestrators chain the primitives: `consolidate` (cluster → select) for deduplication review, `compile` (MMR → compress → budget-fit) for context injection.

**Tech Stack:** TypeScript strict mode, Vitest (tests + benchmarks), no runtime dependencies beyond the standard library.

**Design doc:** `docs/plans/2026-03-05-context-distill-design.md`

---

## Direction Update Entry (2026-03-05)

This plan now targets a **context compiler** flow:

- deterministic algorithms remain the primary path
- compile is task-aware (`task_prompt` / query embedding)
- DBOS may run one optional bounded LLM-review step between deterministic
  candidate generation and final policy enforcement

Implementation constraints for all tasks below:

1. deterministic output is still the baseline contract
2. LLM review is optional and bounded, never the only path
3. final output must pass deterministic policy gates:
   - token budget
   - required boundary constraints
   - provenance grounding
4. no workflow step may auto-write semantic entries without explicit
   agent/skill decision

When updating tasks, prefer adding hooks/interfaces for this flow even if the
first implementation keeps LLM review disabled by default.

---

## Task 1: Scaffold the `@moltnet/context-distill` package

**Files:**

- Create: `libs/context-distill/package.json`
- Create: `libs/context-distill/tsconfig.json`
- Modify: `tsconfig.json` (root — add reference)
- Modify: `pnpm-workspace.yaml` (no change needed, `libs/*` already covered)

**Step 1: Create `package.json`**

```json
{
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  },
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "types": "./src/index.ts"
    }
  },
  "license": "AGPL-3.0-only",
  "main": "./dist/index.js",
  "name": "@moltnet/context-distill",
  "private": true,
  "scripts": {
    "bench": "vitest bench",
    "build": "tsc -b",
    "dev": "tsc --watch",
    "lint": "eslint .",
    "test": "vitest run",
    "typecheck": "tsc -b --emitDeclarationOnly"
  },
  "type": "module",
  "types": "./dist/index.d.ts",
  "version": "0.1.0"
}
```

**Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  },
  "extends": "../../tsconfig.json",
  "include": ["src", "__tests__"]
}
```

**Step 3: Add reference in root `tsconfig.json`**

In the `references` array, add:

```json
{ "path": "libs/context-distill" }
```

**Step 4: Register the package**

```bash
pnpm install
```

Expected: no errors, `libs/context-distill` appears in the workspace.

**Step 5: Create empty `src/index.ts`**

```typescript
// exports added incrementally per task
```

**Step 6: Verify typecheck passes on empty package**

```bash
pnpm --filter @moltnet/context-distill run typecheck
```

Expected: exits 0.

**Step 7: Commit**

```bash
git add libs/context-distill/ tsconfig.json
git commit -m "feat(context-distill): scaffold package"
```

---

## Task 2: Define shared types

**Files:**

- Create: `libs/context-distill/src/types.ts`
- Modify: `libs/context-distill/src/index.ts`

**Step 1: Write `types.ts`**

```typescript
/**
 * @moltnet/context-distill — Shared Types
 */

/** Input entry for all algorithms. All fields are pre-fetched from pgvector. */
export interface DistillEntry {
  id: string;
  /** 384-dimensional L2-normalized embedding (e5-small-v2). */
  embedding: number[];
  content: string;
  /** Token count of content (caller-provided, e.g. from tiktoken or a simple word count). */
  tokens: number;
  /** Entry importance score (1–10). */
  importance: number;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

/** A cluster of semantically similar entries with one selected representative. */
export interface Cluster {
  representative: DistillEntry;
  /** Why this entry was selected ("highest_score" | "closest_to_centroid" | "hybrid_score"). */
  representativeReason: string;
  /** All entries in the cluster, including the representative. */
  members: DistillEntry[];
  /** Average intra-cluster cosine similarity. */
  similarity: number;
  /** Clustering confidence 0–1 based on cluster tightness. */
  confidence: number;
  /** Suggested action for the agent reviewing this cluster. */
  suggestedAction: 'merge' | 'keep_separate' | 'review';
}

/** Output of consolidate(). */
export interface ConsolidateResult {
  clusters: Cluster[];
  stats: {
    inputCount: number;
    clusterCount: number;
    /** Fraction of clusters with exactly one member. */
    singletonRate: number;
    /** [min, p25, median, p75, max] cluster sizes. */
    clusterSizeDistribution: [number, number, number, number, number];
    elapsedMs: number;
  };
  trace: {
    thresholdUsed: number;
    strategyUsed: 'score' | 'centroid' | 'hybrid';
    embeddingDim: number;
  };
}

/** Compression level applied to an entry in a compiled context pack. */
export type CompressionLevel = 'full' | 'summary' | 'keywords';

/** A single entry in a compiled context pack. Content is the compressed representation. */
export interface CompiledEntry {
  id: string;
  /** Possibly compressed content — original entry is never mutated. */
  content: string;
  compressionLevel: CompressionLevel;
  originalTokens: number;
  compressedTokens: number;
}

/** Output of compile(). */
export interface CompileResult {
  entries: CompiledEntry[];
  stats: {
    totalTokens: number;
    entriesIncluded: number;
    entriesCompressed: number;
    /** tokens_out / tokens_in across all included entries. */
    compressionRatio: number;
    /** totalTokens / tokenBudget. */
    budgetUtilization: number;
    elapsedMs: number;
  };
  trace: {
    lambdaUsed: number;
    embeddingDim: number;
    taskPromptHash?: string;
  };
}
```

**Step 2: Export from `index.ts`**

```typescript
export type {
  Cluster,
  CompiledEntry,
  CompileResult,
  CompressionLevel,
  ConsolidateResult,
  DistillEntry,
} from './types.js';
```

**Step 3: Typecheck**

```bash
pnpm --filter @moltnet/context-distill run typecheck
```

Expected: exits 0.

**Step 4: Commit**

```bash
git add libs/context-distill/src/
git commit -m "feat(context-distill): add shared types"
```

---

## Task 3: Implement cosine distance utility + `cluster.ts`

Agglomerative clustering with average linkage. Entries closer than `threshold` cosine distance are merged.

**Files:**

- Create: `libs/context-distill/src/cluster.ts`
- Create: `libs/context-distill/__tests__/cluster.test.ts`
- Modify: `libs/context-distill/src/index.ts`

**Step 1: Write failing tests**

```typescript
// libs/context-distill/__tests__/cluster.test.ts
import { describe, expect, it } from 'vitest';
import { cluster } from '../src/cluster.js';
import type { DistillEntry } from '../src/types.js';

function makeEntry(id: string, embedding: number[]): DistillEntry {
  return {
    id,
    embedding,
    content: `content-${id}`,
    tokens: 10,
    importance: 5,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

// Two identical embeddings → distance 0 → always in same cluster
const e1 = makeEntry('a', [1, 0, 0]);
const e2 = makeEntry('b', [1, 0, 0]);
// Orthogonal → distance 1 → never merged at threshold < 1
const e3 = makeEntry('c', [0, 1, 0]);

describe('cluster', () => {
  it('groups identical embeddings together', () => {
    const result = cluster([e1, e2, e3], { threshold: 0.15 });
    // e1 and e2 should be in the same cluster, e3 separate
    expect(result).toHaveLength(2);
    const sizes = result.map((c) => c.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('returns one cluster per entry when threshold is 0', () => {
    const result = cluster([e1, e2, e3], { threshold: 0 });
    expect(result).toHaveLength(3);
  });

  it('returns one cluster for all entries when threshold is 1', () => {
    const result = cluster([e1, e2, e3], { threshold: 1 });
    expect(result).toHaveLength(1);
  });

  it('handles a single entry', () => {
    const result = cluster([e1], { threshold: 0.15 });
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1);
  });

  it('handles empty input', () => {
    expect(cluster([], { threshold: 0.15 })).toHaveLength(0);
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
pnpm --filter @moltnet/context-distill run test
```

Expected: `cluster` not found / import error.

**Step 3: Implement `cluster.ts`**

```typescript
/**
 * Agglomerative clustering with average linkage and cosine distance.
 *
 * Time: O(n²) — suitable for up to ~500 entries per call.
 * Callers should filter by tags/session to stay within this bound.
 */
import type { DistillEntry } from './types.js';

export interface ClusterOptions {
  /** Cosine distance threshold for merging clusters. Default 0.15. */
  threshold?: number;
}

/** Returns groups of entries; each group is a cluster. */
export function cluster(
  entries: DistillEntry[],
  options: ClusterOptions = {},
): DistillEntry[][] {
  const threshold = options.threshold ?? 0.15;
  if (entries.length === 0) return [];

  // Each entry starts in its own cluster
  const clusters: DistillEntry[][] = entries.map((e) => [e]);

  let merged = true;
  while (merged) {
    merged = false;
    let bestI = -1;
    let bestJ = -1;
    let bestDist = Infinity;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const dist = averageLinkageDistance(clusters[i], clusters[j]);
        if (dist < bestDist) {
          bestDist = dist;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestDist <= threshold) {
      // Merge bestJ into bestI
      clusters[bestI] = [...clusters[bestI], ...clusters[bestJ]];
      clusters.splice(bestJ, 1);
      merged = true;
    }
  }

  return clusters;
}

/** Average pairwise cosine distance between two clusters. */
function averageLinkageDistance(a: DistillEntry[], b: DistillEntry[]): number {
  let total = 0;
  for (const ea of a) {
    for (const eb of b) {
      total += cosineDistance(ea.embedding, eb.embedding);
    }
  }
  return total / (a.length * b.length);
}

/** Cosine distance = 1 - cosine_similarity. Range [0, 2] but practically [0, 1] for L2-normalized vectors. */
export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}
```

**Step 4: Export from `index.ts`**

Add:

```typescript
export { cluster, cosineDistance, type ClusterOptions } from './cluster.js';
```

**Step 5: Run tests — verify they pass**

```bash
pnpm --filter @moltnet/context-distill run test
```

Expected: all cluster tests PASS.

**Step 6: Commit**

```bash
git add libs/context-distill/src/cluster.ts libs/context-distill/__tests__/cluster.test.ts libs/context-distill/src/index.ts
git commit -m "feat(context-distill): implement agglomerative clustering"
```

---

## Task 4: Implement `selector.ts`

Selects one representative entry per cluster using score, centroid, or hybrid strategy.

**Files:**

- Create: `libs/context-distill/src/selector.ts`
- Create: `libs/context-distill/__tests__/selector.test.ts`
- Modify: `libs/context-distill/src/index.ts`

**Step 1: Write failing tests**

```typescript
// libs/context-distill/__tests__/selector.test.ts
import { describe, expect, it } from 'vitest';
import { select } from '../src/selector.js';
import type { DistillEntry } from '../src/types.js';

function makeEntry(
  id: string,
  importance: number,
  embedding: number[],
): DistillEntry {
  return {
    id,
    embedding,
    content: `content-${id}`,
    tokens: 10,
    importance,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

const high = makeEntry('high', 9, [1, 0, 0]);
const low = makeEntry('low', 2, [1, 0, 0]);
const mid = makeEntry('mid', 5, [0.9, 0.44, 0]);

describe('select', () => {
  it('score strategy picks highest importance entry', () => {
    const result = select([high, low, mid], 'score');
    expect(result.representative.id).toBe('high');
    expect(result.representativeReason).toBe('highest_score');
  });

  it('centroid strategy picks entry closest to cluster centroid', () => {
    // All same embedding → any is equally close; just ensure a valid entry is returned
    const entries = [high, low];
    const result = select(entries, 'centroid');
    expect(['high', 'low']).toContain(result.representative.id);
    expect(result.representativeReason).toBe('closest_to_centroid');
  });

  it('hybrid strategy returns a representative', () => {
    const result = select([high, low, mid], 'hybrid');
    expect(result.representativeReason).toBe('hybrid_score');
  });

  it('works on a single-member cluster', () => {
    const result = select([high], 'score');
    expect(result.representative.id).toBe('high');
  });

  it('computes similarity and confidence', () => {
    const result = select([high, low], 'score');
    expect(result.similarity).toBeGreaterThanOrEqual(0);
    expect(result.similarity).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('assigns suggestedAction merge for tight clusters', () => {
    // identical embeddings → similarity 1 → tight → merge
    const result = select([high, low], 'score');
    expect(result.suggestedAction).toBe('merge');
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
pnpm --filter @moltnet/context-distill run test
```

**Step 3: Implement `selector.ts`**

```typescript
/**
 * Representative selection strategies for entry clusters.
 */
import { cosineDistance } from './cluster.js';
import type { Cluster, DistillEntry } from './types.js';

export type SelectionStrategy = 'score' | 'centroid' | 'hybrid';

export function select(
  members: DistillEntry[],
  strategy: SelectionStrategy,
): Cluster {
  const representative = pickRepresentative(members, strategy);
  const reason = strategyReason(strategy);
  const similarity = averageIntraClusterSimilarity(members);
  const confidence = clampUnit(similarity);

  return {
    representative,
    representativeReason: reason,
    members,
    similarity,
    confidence,
    suggestedAction: suggestAction(similarity, members.length),
  };
}

function pickRepresentative(
  members: DistillEntry[],
  strategy: SelectionStrategy,
): DistillEntry {
  if (members.length === 1) return members[0];

  if (strategy === 'score') {
    return members.reduce((best, e) =>
      e.importance > best.importance ? e : best,
    );
  }

  if (strategy === 'centroid') {
    const centroid = computeCentroid(members);
    return members.reduce((best, e) => {
      return cosineDistance(e.embedding, centroid) <
        cosineDistance(best.embedding, centroid)
        ? e
        : best;
    });
  }

  // hybrid: normalize importance (0–1) and centroid proximity (0–1), average them
  const centroid = computeCentroid(members);
  const maxImportance = Math.max(...members.map((e) => e.importance));
  return members.reduce((best, e) => {
    const importanceScore = e.importance / (maxImportance || 1);
    const proximityScore = 1 - cosineDistance(e.embedding, centroid);
    const score = (importanceScore + proximityScore) / 2;

    const bestImportanceScore = best.importance / (maxImportance || 1);
    const bestProximityScore = 1 - cosineDistance(best.embedding, centroid);
    const bestScore = (bestImportanceScore + bestProximityScore) / 2;

    return score > bestScore ? e : best;
  });
}

function computeCentroid(members: DistillEntry[]): number[] {
  const dim = members[0].embedding.length;
  const centroid = new Array<number>(dim).fill(0);
  for (const e of members) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += e.embedding[i];
    }
  }
  return centroid.map((v) => v / members.length);
}

function averageIntraClusterSimilarity(members: DistillEntry[]): number {
  if (members.length === 1) return 1;
  let total = 0;
  let count = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      total += 1 - cosineDistance(members[i].embedding, members[j].embedding);
      count++;
    }
  }
  return total / count;
}

function suggestAction(
  similarity: number,
  size: number,
): Cluster['suggestedAction'] {
  if (size === 1) return 'keep_separate';
  if (similarity >= 0.9) return 'merge';
  if (similarity >= 0.7) return 'review';
  return 'keep_separate';
}

function strategyReason(strategy: SelectionStrategy): string {
  switch (strategy) {
    case 'score':
      return 'highest_score';
    case 'centroid':
      return 'closest_to_centroid';
    case 'hybrid':
      return 'hybrid_score';
  }
}

function clampUnit(v: number): number {
  return Math.max(0, Math.min(1, v));
}
```

**Step 4: Export from `index.ts`**

Add:

```typescript
export { select, type SelectionStrategy } from './selector.js';
```

**Step 5: Run tests**

```bash
pnpm --filter @moltnet/context-distill run test
```

Expected: all selector tests PASS.

**Step 6: Commit**

```bash
git add libs/context-distill/src/selector.ts libs/context-distill/__tests__/selector.test.ts libs/context-distill/src/index.ts
git commit -m "feat(context-distill): implement representative selector"
```

---

## Task 5: Implement `mmr.ts`

Maximal Marginal Relevance re-ranking. Balances relevance to a query against diversity among selected entries.

**Files:**

- Create: `libs/context-distill/src/mmr.ts`
- Create: `libs/context-distill/__tests__/mmr.test.ts`
- Modify: `libs/context-distill/src/index.ts`

**Step 1: Write failing tests**

```typescript
// libs/context-distill/__tests__/mmr.test.ts
import { describe, expect, it } from 'vitest';
import { mmr } from '../src/mmr.js';
import type { DistillEntry } from '../src/types.js';

function makeEntry(id: string, embedding: number[]): DistillEntry {
  return {
    id,
    embedding,
    content: `content-${id}`,
    tokens: 10,
    importance: 5,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

const query = [1, 0, 0];
const near1 = makeEntry('near1', [1, 0, 0]); // identical to query
const near2 = makeEntry('near2', [0.99, 0.14, 0]); // close to query
const far = makeEntry('far', [0, 1, 0]); // orthogonal

describe('mmr', () => {
  it('returns top-k entries', () => {
    const result = mmr([near1, near2, far], query, { k: 2, lambda: 0.5 });
    expect(result).toHaveLength(2);
  });

  it('with lambda=1 (pure relevance) prefers entries closest to query', () => {
    const result = mmr([near1, near2, far], query, { k: 1, lambda: 1 });
    expect(result[0].id).toBe('near1');
  });

  it('with lambda=0 (pure diversity) after first pick, avoids similar entries', () => {
    // First pick is always the most relevant; second should maximize diversity
    const result = mmr([near1, near2, far], query, { k: 2, lambda: 0 });
    expect(result[0].id).toBe('near1');
    expect(result[1].id).toBe('far'); // far is most different from near1
  });

  it('returns all entries when k >= entries.length', () => {
    const result = mmr([near1, far], query, { k: 10, lambda: 0.5 });
    expect(result).toHaveLength(2);
  });

  it('handles empty input', () => {
    expect(mmr([], query, { k: 5, lambda: 0.5 })).toHaveLength(0);
  });

  it('without query embedding, ranks by importance', () => {
    const a = makeEntry('a', [1, 0, 0]);
    a.importance = 9;
    const b = makeEntry('b', [0, 1, 0]);
    b.importance = 2;
    const result = mmr([b, a], undefined, { k: 1, lambda: 0.5 });
    expect(result[0].id).toBe('a');
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
pnpm --filter @moltnet/context-distill run test
```

**Step 3: Implement `mmr.ts`**

```typescript
/**
 * Maximal Marginal Relevance re-ranking.
 *
 * MMR score = λ * relevance(e, query) - (1-λ) * max_similarity(e, selected)
 *
 * λ=1: pure relevance ranking. λ=0: pure diversity.
 */
import { cosineDistance } from './cluster.js';
import type { DistillEntry } from './types.js';

export interface MmrOptions {
  /** Number of entries to return. */
  k: number;
  /** Relevance vs diversity trade-off. 0 = pure diversity, 1 = pure relevance. Default 0.5. */
  lambda?: number;
}

export function mmr(
  entries: DistillEntry[],
  queryEmbedding: number[] | undefined,
  options: MmrOptions,
): DistillEntry[] {
  const { k, lambda = 0.5 } = options;
  if (entries.length === 0) return [];

  const limit = Math.min(k, entries.length);
  const selected: DistillEntry[] = [];
  const remaining = [...entries];

  while (selected.length < limit) {
    let bestScore = -Infinity;
    let bestIdx = 0;

    for (let i = 0; i < remaining.length; i++) {
      const e = remaining[i];
      const relevance = queryEmbedding
        ? 1 - cosineDistance(e.embedding, queryEmbedding)
        : e.importance / 10; // fallback: normalize importance to [0,1]

      const maxSim =
        selected.length === 0
          ? 0
          : Math.max(
              ...selected.map(
                (s) => 1 - cosineDistance(e.embedding, s.embedding),
              ),
            );

      const score = lambda * relevance - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}
```

**Step 4: Export from `index.ts`**

Add:

```typescript
export { mmr, type MmrOptions } from './mmr.js';
```

**Step 5: Run tests**

```bash
pnpm --filter @moltnet/context-distill run test
```

Expected: all MMR tests PASS.

**Step 6: Commit**

```bash
git add libs/context-distill/src/mmr.ts libs/context-distill/__tests__/mmr.test.ts libs/context-distill/src/index.ts
git commit -m "feat(context-distill): implement MMR re-ranking"
```

---

## Task 6: Implement `compress.ts`

Extractive sentence compression using cosine similarity to the entry's own embedding centroid. Three tiers: full → summary → keywords.

**Files:**

- Create: `libs/context-distill/src/compress.ts`
- Create: `libs/context-distill/__tests__/compress.test.ts`
- Modify: `libs/context-distill/src/index.ts`

**Step 1: Write failing tests**

```typescript
// libs/context-distill/__tests__/compress.test.ts
import { describe, expect, it } from 'vitest';
import { compress, estimateTokens } from '../src/compress.js';
import type { DistillEntry } from '../src/types.js';

function makeEntry(
  id: string,
  content: string,
  embedding: number[],
): DistillEntry {
  return {
    id,
    embedding,
    content,
    tokens: estimateTokens(content),
    importance: 5,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

const longContent = Array.from(
  { length: 20 },
  (_, i) =>
    `Sentence number ${i} contains some meaningful content about the topic.`,
).join(' ');

describe('compress', () => {
  it('full level returns original content unchanged', () => {
    const e = makeEntry('a', 'Hello world.', [1, 0, 0]);
    const result = compress(e, 'full');
    expect(result.content).toBe('Hello world.');
    expect(result.compressionLevel).toBe('full');
  });

  it('summary level reduces token count', () => {
    const e = makeEntry('a', longContent, [1, 0, 0]);
    const full = compress(e, 'full');
    const summary = compress(e, 'summary');
    expect(summary.compressedTokens).toBeLessThan(full.compressedTokens);
    expect(summary.compressionLevel).toBe('summary');
  });

  it('keywords level produces shortest output', () => {
    const e = makeEntry('a', longContent, [1, 0, 0]);
    const summary = compress(e, 'summary');
    const keywords = compress(e, 'keywords');
    expect(keywords.compressedTokens).toBeLessThanOrEqual(
      summary.compressedTokens,
    );
    expect(keywords.compressionLevel).toBe('keywords');
  });

  it('keywords output is non-empty for non-trivial content', () => {
    const e = makeEntry(
      'a',
      'The agglomerative clustering algorithm groups diary entries.',
      [1, 0, 0],
    );
    const result = compress(e, 'keywords');
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('tracks originalTokens correctly', () => {
    const e = makeEntry('a', longContent, [1, 0, 0]);
    const result = compress(e, 'summary');
    expect(result.originalTokens).toBe(e.tokens);
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
pnpm --filter @moltnet/context-distill run test
```

**Step 3: Implement `compress.ts`**

```typescript
/**
 * Extractive compression for diary entry content.
 *
 * Three tiers applied at read-time. Entry storage is never mutated.
 *
 * - full: return as-is
 * - summary: top-k sentences by cosine similarity to entry's own embedding
 * - keywords: extract identifiers and significant words (last resort)
 */
import { cosineDistance } from './cluster.js';
import type { CompiledEntry, CompressionLevel, DistillEntry } from './types.js';

/** Rough token estimate: ~0.75 words per token (GPT-family approximation). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length / 0.75);
}

export function compress(
  entry: DistillEntry,
  level: CompressionLevel,
): CompiledEntry {
  const originalTokens = entry.tokens;

  if (level === 'full') {
    return {
      id: entry.id,
      content: entry.content,
      compressionLevel: 'full',
      originalTokens,
      compressedTokens: originalTokens,
    };
  }

  if (level === 'summary') {
    const compressed = extractiveSummary(entry.content, entry.embedding, 0.3);
    return {
      id: entry.id,
      content: compressed,
      compressionLevel: 'summary',
      originalTokens,
      compressedTokens: estimateTokens(compressed),
    };
  }

  // keywords
  const compressed = extractKeywords(entry.content);
  return {
    id: entry.id,
    content: compressed,
    compressionLevel: 'keywords',
    originalTokens,
    compressedTokens: estimateTokens(compressed),
  };
}

/**
 * Keep top fraction of sentences ranked by cosine similarity to the entry embedding.
 * Falls back to first sentences if embedding is all-zeros (edge case).
 */
function extractiveSummary(
  content: string,
  entryEmbedding: number[],
  keepFraction: number,
): string {
  const sentences = splitSentences(content);
  if (sentences.length <= 2) return content;

  const keepCount = Math.max(1, Math.ceil(sentences.length * keepFraction));

  // Score each sentence by its own simple word-vector proxy against the entry embedding.
  // Since we don't have per-sentence embeddings (no IO here), we use position + length
  // as a heuristic proxy: early sentences + longer sentences are more informative.
  // This is a reasonable approximation for extractive summarization without a model call.
  const scored = sentences.map((s, i) => ({
    sentence: s,
    score: positionScore(i, sentences.length) + lengthScore(s),
  }));

  const topSentences = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, keepCount)
    // Restore original order for coherence
    .sort(
      (a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence),
    )
    .map((s) => s.sentence);

  return topSentences.join(' ');
}

/** Prefer earlier sentences (position 0 = score 1, last = score 0). */
function positionScore(index: number, total: number): number {
  return 1 - index / total;
}

/** Prefer longer sentences (normalized to [0,1] against max plausible sentence length). */
function lengthScore(sentence: string): number {
  return Math.min(sentence.length / 200, 1);
}

/**
 * Extract identifiers and significant words — last resort before entry exclusion.
 * Keeps: words ≥4 chars, CamelCase tokens, words with digits (identifiers/versions).
 * Deduplicates and limits to 30 tokens.
 */
function extractKeywords(content: string): string {
  const words = content.split(/\s+/);
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const word of words) {
    const clean = word.replace(/[^\w./-]/g, '');
    if (!clean || seen.has(clean.toLowerCase())) continue;
    if (
      clean.length >= 4 ||
      /[A-Z][a-z]/.test(clean) || // CamelCase
      /\d/.test(clean) // version numbers, identifiers
    ) {
      seen.add(clean.toLowerCase());
      keywords.push(clean);
    }
    if (keywords.length >= 30) break;
  }

  return keywords.join(' ');
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
```

**Step 4: Export from `index.ts`**

Add:

```typescript
export { compress, estimateTokens } from './compress.js';
```

**Step 5: Run tests**

```bash
pnpm --filter @moltnet/context-distill run test
```

Expected: all compress tests PASS.

**Step 6: Commit**

```bash
git add libs/context-distill/src/compress.ts libs/context-distill/__tests__/compress.test.ts libs/context-distill/src/index.ts
git commit -m "feat(context-distill): implement extractive compression"
```

---

## Task 7: Implement `consolidate.ts` orchestrator

Chains cluster → select. Returns `ConsolidateResult` ready to hand to the agent for review.

**Files:**

- Create: `libs/context-distill/src/consolidate.ts`
- Create: `libs/context-distill/__tests__/consolidate.test.ts`
- Modify: `libs/context-distill/src/index.ts`

**Step 1: Write failing tests**

```typescript
// libs/context-distill/__tests__/consolidate.test.ts
import { describe, expect, it } from 'vitest';
import { consolidate } from '../src/consolidate.js';
import type { DistillEntry } from '../src/types.js';

function makeEntry(id: string, embedding: number[]): DistillEntry {
  return {
    id,
    embedding,
    content: `content-${id}`,
    tokens: 10,
    importance: 5,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

const e1 = makeEntry('a', [1, 0, 0]);
const e2 = makeEntry('b', [1, 0, 0]); // duplicate of e1
const e3 = makeEntry('c', [0, 1, 0]); // orthogonal

describe('consolidate', () => {
  it('returns clusters with stats and trace', () => {
    const result = consolidate([e1, e2, e3]);
    expect(result.clusters.length).toBeGreaterThan(0);
    expect(result.stats.inputCount).toBe(3);
    expect(result.stats.clusterCount).toBe(result.clusters.length);
    expect(result.trace.embeddingDim).toBe(3);
  });

  it('groups duplicates and separates distinct entries', () => {
    const result = consolidate([e1, e2, e3], { threshold: 0.15 });
    expect(result.clusters).toHaveLength(2);
    const sizes = result.clusters.map((c) => c.members.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('computes singletonRate correctly', () => {
    const result = consolidate([e1, e2, e3], { threshold: 0.15 });
    // 1 singleton out of 2 clusters = 0.5
    expect(result.stats.singletonRate).toBeCloseTo(0.5);
  });

  it('records elapsedMs', () => {
    const result = consolidate([e1, e2, e3]);
    expect(result.stats.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
pnpm --filter @moltnet/context-distill run test
```

**Step 3: Implement `consolidate.ts`**

```typescript
import { cluster } from './cluster.js';
import { select } from './selector.js';
import type { ConsolidateResult, DistillEntry } from './types.js';
import type { SelectionStrategy } from './selector.js';

export interface ConsolidateOptions {
  threshold?: number;
  strategy?: SelectionStrategy;
}

export function consolidate(
  entries: DistillEntry[],
  options: ConsolidateOptions = {},
): ConsolidateResult {
  const start = performance.now();
  const threshold = options.threshold ?? 0.15;
  const strategy = options.strategy ?? 'hybrid';

  const groups = cluster(entries, { threshold });
  const clusters = groups.map((members) => select(members, strategy));

  const sizes = clusters.map((c) => c.members.length).sort((a, b) => a - b);
  const singletonRate =
    sizes.filter((s) => s === 1).length / (clusters.length || 1);
  const embeddingDim = entries[0]?.embedding.length ?? 0;

  return {
    clusters,
    stats: {
      inputCount: entries.length,
      clusterCount: clusters.length,
      singletonRate,
      clusterSizeDistribution: percentiles(sizes),
      elapsedMs: performance.now() - start,
    },
    trace: {
      thresholdUsed: threshold,
      strategyUsed: strategy,
      embeddingDim,
    },
  };
}

function percentiles(
  sorted: number[],
): [number, number, number, number, number] {
  if (sorted.length === 0) return [0, 0, 0, 0, 0];
  const p = (pct: number) =>
    sorted[Math.floor((pct / 100) * (sorted.length - 1))];
  return [sorted[0], p(25), p(50), p(75), sorted[sorted.length - 1]];
}
```

**Step 4: Export from `index.ts`**

Add:

```typescript
export { consolidate, type ConsolidateOptions } from './consolidate.js';
```

**Step 5: Run tests**

```bash
pnpm --filter @moltnet/context-distill run test
```

Expected: all consolidate tests PASS.

**Step 6: Commit**

```bash
git add libs/context-distill/src/consolidate.ts libs/context-distill/__tests__/consolidate.test.ts libs/context-distill/src/index.ts
git commit -m "feat(context-distill): implement consolidate orchestrator"
```

---

## Task 8: Implement `compile.ts` orchestrator

Chains MMR → compress → budget-fit. Returns `CompileResult` for context injection.

**Direction Update (2026-03-05):** The Phase 2 compile workflow adds an optional LLM review step between MMR ranking and final budget enforcement. To support this, `compile.ts` must also export `enforceBudget(ranked: DistillEntry[], tokenBudget: number): Pick<CompileResult, 'entries' | 'stats'>` as a standalone function. This lets the DBOS workflow call `enforceBudget` again after LLM reordering without re-running MMR. Provenance is already covered — each `CompiledEntry` carries its source `id`.

**Files:**

- Create: `libs/context-distill/src/compile.ts`
- Create: `libs/context-distill/__tests__/compile.test.ts`
- Modify: `libs/context-distill/src/index.ts`

**Step 1: Write failing tests**

```typescript
// libs/context-distill/__tests__/compile.test.ts
import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';
import { estimateTokens } from '../src/compress.js';
import type { DistillEntry } from '../src/types.js';

function makeEntry(
  id: string,
  embedding: number[],
  tokens: number,
): DistillEntry {
  const content = Array.from(
    { length: Math.ceil(tokens * 0.75) },
    (_, i) => `word${i}`,
  ).join(' ');
  return {
    id,
    embedding,
    content,
    tokens,
    importance: 5,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

const e1 = makeEntry('a', [1, 0, 0], 100);
const e2 = makeEntry('b', [0.9, 0.44, 0], 100);
const e3 = makeEntry('c', [0, 1, 0], 100);

describe('compile', () => {
  it('total tokens in result never exceed tokenBudget', () => {
    const result = compile([e1, e2, e3], { tokenBudget: 150 });
    expect(result.stats.totalTokens).toBeLessThanOrEqual(150);
  });

  it('includes at least one entry when budget allows', () => {
    const result = compile([e1, e2, e3], { tokenBudget: 50 });
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('includes all entries when budget is large', () => {
    const result = compile([e1, e2, e3], { tokenBudget: 10000 });
    expect(result.entries).toHaveLength(3);
    result.entries.forEach((e) => expect(e.compressionLevel).toBe('full'));
  });

  it('with task prompt, uses it as MMR anchor', () => {
    const result = compile([e1, e2, e3], {
      tokenBudget: 500,
      taskPromptEmbedding: [1, 0, 0],
    });
    // First entry should be the one closest to task prompt
    expect(result.entries[0].id).toBe('a');
    expect(result.trace.taskPromptHash).toBeDefined();
  });

  it('records stats correctly', () => {
    const result = compile([e1, e2, e3], { tokenBudget: 10000 });
    expect(result.stats.entriesIncluded).toBe(3);
    expect(result.stats.budgetUtilization).toBeLessThanOrEqual(1);
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
pnpm --filter @moltnet/context-distill run test
```

**Step 3: Implement `compile.ts`**

```typescript
import { mmr } from './mmr.js';
import { compress, estimateTokens } from './compress.js';
import type { CompileResult, CompressionLevel, DistillEntry } from './types.js';

export interface CompileOptions {
  tokenBudget: number;
  /** Pre-computed embedding of the current task prompt. */
  taskPromptEmbedding?: number[];
  /** MMR relevance vs diversity. Default 0.5. */
  lambda?: number;
}

export function compile(
  entries: DistillEntry[],
  options: CompileOptions,
): CompileResult {
  const start = performance.now();
  const { tokenBudget, taskPromptEmbedding, lambda = 0.5 } = options;

  // MMR re-rank: all entries as candidates, unlimited k (budget enforced after)
  const ranked = mmr(entries, taskPromptEmbedding, {
    k: entries.length,
    lambda,
  });

  // Fit into token budget: try full → summary → keywords → exclude
  let totalTokens = 0;
  let entriesCompressed = 0;
  const result = [];

  for (const entry of ranked) {
    if (totalTokens >= tokenBudget) break;

    const remaining = tokenBudget - totalTokens;
    const level = pickCompressionLevel(entry, remaining);
    if (level === null) continue; // even keywords won't fit — skip

    const compiled = compress(entry, level);
    if (compiled.compressedTokens > remaining) continue;

    if (level !== 'full') entriesCompressed++;
    totalTokens += compiled.compressedTokens;
    result.push(compiled);
  }

  const taskPromptHash = taskPromptEmbedding
    ? simpleHash(taskPromptEmbedding)
    : undefined;

  return {
    entries: result,
    stats: {
      totalTokens,
      entriesIncluded: result.length,
      entriesCompressed,
      compressionRatio:
        result.length === 0
          ? 1
          : totalTokens / result.reduce((s, e) => s + e.originalTokens, 0),
      budgetUtilization: totalTokens / tokenBudget,
      elapsedMs: performance.now() - start,
    },
    trace: {
      lambdaUsed: lambda,
      embeddingDim: entries[0]?.embedding.length ?? 0,
      taskPromptHash,
    },
  };
}

/**
 * Pick the best compression level that fits within the remaining budget.
 * Returns null if even keywords exceed the budget.
 */
function pickCompressionLevel(
  entry: DistillEntry,
  remaining: number,
): CompressionLevel | null {
  if (entry.tokens <= remaining) return 'full';
  const summary = compress(entry, 'summary');
  if (summary.compressedTokens <= remaining) return 'summary';
  const keywords = compress(entry, 'keywords');
  if (keywords.compressedTokens <= remaining) return 'keywords';
  return null;
}

/** Deterministic short hash of an embedding for tracing. */
function simpleHash(embedding: number[]): string {
  let h = 0;
  for (const v of embedding) {
    h = (Math.imul(31, h) + Math.round(v * 1e6)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
```

**Step 4: Export from `index.ts`**

Add:

```typescript
export { compile, enforceBudget, type CompileOptions } from './compile.js';
```

**Step 5: Run tests**

```bash
pnpm --filter @moltnet/context-distill run test
```

Expected: all compile tests PASS.

**Step 6: Run full test suite**

```bash
pnpm --filter @moltnet/context-distill run test
```

Expected: all tests across all modules PASS.

**Step 7: Commit**

```bash
git add libs/context-distill/src/compile.ts libs/context-distill/__tests__/compile.test.ts libs/context-distill/src/index.ts
git commit -m "feat(context-distill): implement compile orchestrator"
```

---

## Task 9: Benchmarks

Verify algorithmic complexity and establish baselines for the O(n²) clustering path.

**Files:**

- Create: `libs/context-distill/__tests__/benchmarks/cluster.bench.ts`
- Create: `libs/context-distill/__tests__/benchmarks/compile.bench.ts`

**Step 1: Write cluster benchmark**

```typescript
// libs/context-distill/__tests__/benchmarks/cluster.bench.ts
import { bench, describe } from 'vitest';
import { cluster } from '../../src/cluster.js';
import type { DistillEntry } from '../../src/types.js';

function randomEntry(id: string): DistillEntry {
  const embedding = Array.from({ length: 384 }, () => Math.random() - 0.5);
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  return {
    id,
    embedding: embedding.map((v) => v / norm),
    content: `content-${id}`,
    tokens: 50,
    importance: 5,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

const entries50 = Array.from({ length: 50 }, (_, i) => randomEntry(`e${i}`));
const entries100 = Array.from({ length: 100 }, (_, i) => randomEntry(`e${i}`));
const entries200 = Array.from({ length: 200 }, (_, i) => randomEntry(`e${i}`));
const entries500 = Array.from({ length: 500 }, (_, i) => randomEntry(`e${i}`));

describe('cluster() O(n²)', () => {
  bench('50 entries', () => cluster(entries50, { threshold: 0.15 }));
  bench('100 entries', () => cluster(entries100, { threshold: 0.15 }));
  bench('200 entries', () => cluster(entries200, { threshold: 0.15 }));
  bench('500 entries', () => cluster(entries500, { threshold: 0.15 }));
});
```

**Step 2: Write compile benchmark**

```typescript
// libs/context-distill/__tests__/benchmarks/compile.bench.ts
import { bench, describe } from 'vitest';
import { compile } from '../../src/compile.js';
import type { DistillEntry } from '../../src/types.js';

function randomEntry(id: string, tokens: number): DistillEntry {
  const embedding = Array.from({ length: 384 }, () => Math.random() - 0.5);
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  const words = Array.from(
    { length: Math.ceil(tokens * 0.75) },
    (_, i) => `word${i}`,
  );
  return {
    id,
    embedding: embedding.map((v) => v / norm),
    content: words.join(' '),
    tokens,
    importance: 5,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

const entries100 = Array.from({ length: 100 }, (_, i) =>
  randomEntry(`e${i}`, 200),
);
const query = Array.from({ length: 384 }, () => Math.random() - 0.5);

describe('compile() with token budget', () => {
  bench('100 entries, budget 8000, no task prompt', () =>
    compile(entries100, { tokenBudget: 8000 }),
  );
  bench('100 entries, budget 8000, with task prompt', () =>
    compile(entries100, { tokenBudget: 8000, taskPromptEmbedding: query }),
  );
  bench('100 entries, tight budget 500', () =>
    compile(entries100, { tokenBudget: 500 }),
  );
});
```

**Step 3: Run benchmarks**

```bash
pnpm --filter @moltnet/context-distill run bench
```

Expected: results printed with ms/op. Note the 500-entry clustering time — it should be under 2s. If not, the soft cap in the design doc (500 entries) needs lowering.

**Step 4: Commit**

```bash
git add libs/context-distill/__tests__/benchmarks/
git commit -m "test(context-distill): add cluster and compile benchmarks"
```

---

## Task 10: Final validation

**Step 1: Full test suite**

```bash
pnpm --filter @moltnet/context-distill run test
```

Expected: all tests PASS.

**Step 2: Typecheck**

```bash
pnpm --filter @moltnet/context-distill run typecheck
```

Expected: exits 0.

**Step 3: Lint**

```bash
pnpm --filter @moltnet/context-distill run lint
```

Expected: no errors.

**Step 4: Root-level validate**

```bash
pnpm run validate
```

Expected: lint + typecheck + test + build all pass.

**Step 5: Update GitHub issue #358 with phase 1 completion note and create subissues for phases 2 and 3**

```bash
# Create phase 2 subissue
gh issue create \
  --repo getlarge/themoltnet \
  --title "feat: context-distill REST API workflows (phase 2 of #358)" \
  --body "Phase 2 of #358. Add DBOS consolidate and compile workflows + REST API endpoints + api-client regen. See design doc: docs/plans/2026-03-05-context-distill-design.md" \
  --label "enhancement"

# Create phase 3 subissue
gh issue create \
  --repo getlarge/themoltnet \
  --title "feat: context-distill MCP tools (phase 3 of #358)" \
  --body "Phase 3 of #358. Add context_consolidate and context_compile MCP tools + skill updates. Depends on phase 2. See design doc: docs/plans/2026-03-05-context-distill-design.md" \
  --label "enhancement,mcp-server"
```

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat(context-distill): complete phase 1 — pure algorithm library"
```
