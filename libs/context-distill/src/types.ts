/**
 * @moltnet/context-distill — Shared Types
 */

/** Input entry for all algorithms. All fields are pre-fetched from pgvector. */
export interface DistillEntry {
  id: string;
  /** 384-dimensional L2-normalized embedding (e5-small-v2). */
  embedding: number[];
  content: string;
  /** Token count of content (caller-provided). */
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
