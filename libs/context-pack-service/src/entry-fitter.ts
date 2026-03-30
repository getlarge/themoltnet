import {
  compress,
  type DistillEntry,
  estimateTokens,
} from '@moltnet/context-distill';
import type { CompressionLevel } from '@moltnet/crypto-service';

import type { FitResult, FittedEntry, ResolvedSelection } from './types.js';

export function fitEntries(
  selectedEntries: ResolvedSelection[],
  tokenBudget?: number,
): FitResult {
  const start = performance.now();
  const distillEntries = selectedEntries.map(
    ({ row }): DistillEntry => ({
      id: row.id,
      embedding: [],
      content: row.content,
      tokens: estimateTokens(row.content),
      importance: row.importance,
      createdAt: row.createdAt.toISOString(),
    }),
  );
  const distillById = new Map(distillEntries.map((e) => [e.id, e]));
  const compiledById = new Map(
    distillEntries.map((e) => [e.id, compress(e, 'full')]),
  );

  let totalTokens = Array.from(compiledById.values()).reduce(
    (sum, e) => sum + e.compressedTokens,
    0,
  );

  if (tokenBudget !== undefined && totalTokens > tokenBudget) {
    // Pass 1: compress tail entries to summary
    for (
      let i = selectedEntries.length - 1;
      i >= 0 && totalTokens > tokenBudget;
      i -= 1
    ) {
      const source = distillById.get(selectedEntries[i].row.id);
      const current = compiledById.get(selectedEntries[i].row.id);
      if (!source || !current || current.compressionLevel !== 'full') continue;
      const summary = compress(source, 'summary');
      totalTokens += summary.compressedTokens - current.compressedTokens;
      compiledById.set(selectedEntries[i].row.id, summary);
    }

    // Pass 2: compress to keywords
    for (
      let i = selectedEntries.length - 1;
      i >= 0 && totalTokens > tokenBudget;
      i -= 1
    ) {
      const source = distillById.get(selectedEntries[i].row.id);
      const current = compiledById.get(selectedEntries[i].row.id);
      if (!source || !current || current.compressionLevel !== 'summary')
        continue;
      const keywords = compress(source, 'keywords');
      totalTokens += keywords.compressedTokens - current.compressedTokens;
      compiledById.set(selectedEntries[i].row.id, keywords);
    }

    // Pass 3: drop tail entries
    for (
      let i = selectedEntries.length - 1;
      i >= 0 && totalTokens > tokenBudget;
      i -= 1
    ) {
      const current = compiledById.get(selectedEntries[i].row.id);
      if (!current) continue;
      totalTokens -= current.compressedTokens;
      compiledById.delete(selectedEntries[i].row.id);
    }
  }

  const resultEntries: FittedEntry[] = [];
  for (const { rank, row } of selectedEntries) {
    const compiled = compiledById.get(row.id);
    if (!compiled) continue; // dropped during budget fitting
    if (!row.contentHash) {
      throw new Error(`Entry ${row.id} has no contentHash — cannot be packed`);
    }
    resultEntries.push({
      entryId: row.id,
      entryCidSnapshot: row.contentHash,
      rank,
      compressionLevel: compiled.compressionLevel as CompressionLevel,
      originalTokens: compiled.originalTokens,
      packedTokens: compiled.compressedTokens,
    });
  }

  const originalTotal = resultEntries.reduce(
    (sum, e) => sum + e.originalTokens,
    0,
  );
  const packedTotal = resultEntries.reduce((sum, e) => sum + e.packedTokens, 0);

  return {
    entries: resultEntries,
    stats: {
      totalTokens: packedTotal,
      entriesIncluded: resultEntries.length,
      entriesCompressed: resultEntries.filter(
        (e) => e.compressionLevel !== 'full',
      ).length,
      compressionRatio: originalTotal === 0 ? 1 : packedTotal / originalTotal,
      budgetUtilization:
        tokenBudget === undefined
          ? packedTotal === 0
            ? 0
            : 1
          : packedTotal / tokenBudget,
      elapsedMs: performance.now() - start,
    },
  };
}
