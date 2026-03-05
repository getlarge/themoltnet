import { compress } from './compress.js';
import { mmr } from './mmr.js';
import type { CompileResult, CompressionLevel, DistillEntry } from './types.js';

export interface CompileOptions {
  tokenBudget: number;
  /** Pre-computed embedding of the current task prompt. MMR anchors to this. */
  taskPromptEmbedding?: number[];
  /** MMR relevance vs diversity. 0 = pure diversity, 1 = pure relevance. Default 0.5. */
  lambda?: number;
}

/**
 * Full compile pipeline: MMR re-rank → enforceBudget.
 * Call this for the initial context pack assembly.
 */
export function compile(
  entries: DistillEntry[],
  options: CompileOptions,
): CompileResult {
  const start = performance.now();
  const { tokenBudget, taskPromptEmbedding, lambda = 0.5 } = options;

  const ranked = mmr(entries, taskPromptEmbedding, {
    k: entries.length,
    lambda,
  });

  const { entries: compiledEntries, stats: budgetStats } = enforceBudget(
    ranked,
    tokenBudget,
  );

  const taskPromptHash = taskPromptEmbedding
    ? simpleHash(taskPromptEmbedding)
    : undefined;

  return {
    entries: compiledEntries,
    stats: {
      ...budgetStats,
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
 * Deterministic budget enforcement over a pre-ranked entry list.
 *
 * Used as a standalone step in the Phase 2 DBOS workflow so the hard
 * token budget and provenance guarantees are re-applied after an
 * optional LLM review step reorders the candidates.
 *
 * Returns a subset of CompileResult (entries + stats, no trace) so callers
 * can wrap it with their own trace metadata.
 */
export function enforceBudget(
  ranked: DistillEntry[],
  tokenBudget: number,
): Pick<CompileResult, 'entries' | 'stats'> {
  let totalTokens = 0;
  let entriesCompressed = 0;
  const result = [];

  for (const entry of ranked) {
    if (totalTokens >= tokenBudget) break;

    const remaining = tokenBudget - totalTokens;
    const level = pickLevel(entry, remaining);
    if (level === null) continue;

    const compiled = compress(entry, level);
    if (compiled.compressedTokens > remaining) continue;

    if (level !== 'full') entriesCompressed++;
    totalTokens += compiled.compressedTokens;
    result.push(compiled);
  }

  const originalTotal = result.reduce((s, e) => s + e.originalTokens, 0);

  return {
    entries: result,
    stats: {
      totalTokens,
      entriesIncluded: result.length,
      entriesCompressed,
      compressionRatio: originalTotal === 0 ? 1 : totalTokens / originalTotal,
      budgetUtilization: tokenBudget === 0 ? 0 : totalTokens / tokenBudget,
      elapsedMs: 0, // filled in by compile(); callers set their own timing
    },
  };
}

/** Pick the best compression level that fits within the remaining budget. Returns null if nothing fits. */
function pickLevel(
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
