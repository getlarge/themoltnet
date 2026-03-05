import { describe, expect, it } from 'vitest';

import { compile, enforceBudget } from '../src/compile.js';
import { estimateTokens } from '../src/compress.js';
import type { DistillEntry } from '../src/types.js';

function makeEntry(
  id: string,
  embedding: number[],
  tokens: number,
  importance = 5,
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
    importance,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

function randomNormalizedEmbedding(dim: number): number[] {
  const v = Array.from({ length: dim }, () => Math.random() - 0.5);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

const e1 = makeEntry('a', [1, 0, 0], 100);
const e2 = makeEntry('b', [0.9, 0.44, 0], 100);
const e3 = makeEntry('c', [0, 1, 0], 100);

describe('compile — unit', () => {
  it('total tokens never exceed tokenBudget', () => {
    const result = compile([e1, e2, e3], { tokenBudget: 150 });
    expect(result.stats.totalTokens).toBeLessThanOrEqual(150);
  });

  it('includes at least one entry when budget allows', () => {
    const result = compile([e1, e2, e3], { tokenBudget: 50 });
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('includes all entries at full level when budget is large', () => {
    const result = compile([e1, e2, e3], { tokenBudget: 10000 });
    expect(result.entries).toHaveLength(3);
    result.entries.forEach((e) => expect(e.compressionLevel).toBe('full'));
  });

  it('with task prompt, first entry is the closest to query', () => {
    const result = compile([e1, e2, e3], {
      tokenBudget: 10000,
      taskPromptEmbedding: [1, 0, 0],
    });
    expect(result.entries[0].id).toBe('a');
  });

  it('sets taskPromptHash when task prompt provided', () => {
    const result = compile([e1], {
      tokenBudget: 10000,
      taskPromptEmbedding: [1, 0, 0],
    });
    expect(result.trace.taskPromptHash).toBeDefined();
    expect(typeof result.trace.taskPromptHash).toBe('string');
  });

  it('taskPromptHash is undefined when no prompt provided', () => {
    const result = compile([e1], { tokenBudget: 10000 });
    expect(result.trace.taskPromptHash).toBeUndefined();
  });

  it('records lambdaUsed in trace', () => {
    const result = compile([e1], { tokenBudget: 10000, lambda: 0.7 });
    expect(result.trace.lambdaUsed).toBe(0.7);
  });

  it('defaults lambda to 0.5', () => {
    const result = compile([e1], { tokenBudget: 10000 });
    expect(result.trace.lambdaUsed).toBe(0.5);
  });

  it('records embeddingDim in trace', () => {
    const result = compile([e1], { tokenBudget: 10000 });
    expect(result.trace.embeddingDim).toBe(3);
  });

  it('budgetUtilization is between 0 and 1', () => {
    const result = compile([e1, e2, e3], { tokenBudget: 10000 });
    expect(result.stats.budgetUtilization).toBeGreaterThanOrEqual(0);
    expect(result.stats.budgetUtilization).toBeLessThanOrEqual(1);
  });

  it('handles empty input', () => {
    const result = compile([], { tokenBudget: 1000 });
    expect(result.entries).toHaveLength(0);
    expect(result.stats.totalTokens).toBe(0);
  });

  it('compresses entries that do not fit at full level', () => {
    // Use entries with real sentence content so extractive summary can reduce tokens.
    // small = 5 tokens (fits at full), big = many tokens (won't fit at full in remaining budget).
    const sentences10 = Array.from(
      { length: 10 },
      (_, i) =>
        `This is sentence number ${i} about important topic ${i} with enough words.`,
    ).join(' ');
    const big: DistillEntry = {
      id: 'big',
      embedding: [0.9, 0.44, 0],
      content: sentences10,
      tokens: estimateTokens(sentences10),
      importance: 5,
      createdAt: '2024-01-01T00:00:00Z',
    };
    const small = makeEntry('small', [1, 0, 0], 5);
    // budget = small.tokens + 30 — big (160 tokens) can't fit at full or summary (~48 tokens),
    // but keywords (capped at 30 tokens) will fit exactly within the remaining 30 tokens
    const budget = small.tokens + 30;
    const result = compile([small, big], { tokenBudget: budget });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].compressionLevel).toBe('full');
    expect(['summary', 'keywords']).toContain(
      result.entries[1].compressionLevel,
    );
    expect(result.stats.totalTokens).toBeLessThanOrEqual(budget);
  });

  it('entriesCompressed counts non-full entries', () => {
    const result = compile([e1, e2, e3], { tokenBudget: 120 });
    const nonFull = result.entries.filter(
      (e) => e.compressionLevel !== 'full',
    ).length;
    expect(result.stats.entriesCompressed).toBe(nonFull);
  });
});

describe('enforceBudget — unit', () => {
  it('returns entries within token budget', () => {
    const result = enforceBudget([e1, e2, e3], 150);
    expect(result.stats.totalTokens).toBeLessThanOrEqual(150);
  });

  it('includes all entries when budget is large', () => {
    const result = enforceBudget([e1, e2, e3], 10000);
    expect(result.entries).toHaveLength(3);
  });

  it('handles empty input', () => {
    const result = enforceBudget([], 1000);
    expect(result.entries).toHaveLength(0);
    expect(result.stats.totalTokens).toBe(0);
  });

  it('handles tokenBudget=0 — returns nothing', () => {
    const result = enforceBudget([e1, e2, e3], 0);
    expect(result.entries).toHaveLength(0);
    expect(result.stats.totalTokens).toBe(0);
    expect(result.stats.budgetUtilization).toBe(0);
  });

  it('preserves input order', () => {
    const result = enforceBudget([e1, e2, e3], 10000);
    expect(result.entries.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('compressionRatio is <= 1 when compression occurs', () => {
    const result = enforceBudget([e1, e2, e3], 120);
    if (result.stats.entriesCompressed > 0) {
      expect(result.stats.compressionRatio).toBeLessThanOrEqual(1);
    }
  });

  it('includes entry that fits only at keywords level', () => {
    // e1 = 100 tokens; budget=30 → too big for full or summary, but keywords ≤ 30 tokens
    const result = enforceBudget([e1], 30);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].compressionLevel).toBe('keywords');
    expect(result.stats.totalTokens).toBeLessThanOrEqual(30);
  });

  it('skips an entry that cannot fit even at keywords level', () => {
    // A 2000-token entry with sparse content: keywords will still be ≤ 30 tokens.
    // Use a very small budget of 5 tokens — nothing fits.
    const huge = makeEntry('huge', [1, 0, 0], 2000);
    const result = enforceBudget([huge], 5);
    expect(result.entries).toHaveLength(0);
  });

  it('entriesIncluded matches entries array length', () => {
    const result = enforceBudget([e1, e2, e3], 10000);
    expect(result.stats.entriesIncluded).toBe(result.entries.length);
  });
});

describe('compile — integration properties', () => {
  it('output tokens never exceed budget for any input size', () => {
    for (const budget of [50, 200, 1000, 8000]) {
      const entries = Array.from({ length: 20 }, (_, i) =>
        makeEntry(`e${i}`, randomNormalizedEmbedding(384), 150),
      );
      const result = compile(entries, { tokenBudget: budget });
      expect(result.stats.totalTokens).toBeLessThanOrEqual(budget);
    }
  });

  it('all output entry ids are from the input set', () => {
    const entries = [e1, e2, e3];
    const inputIds = new Set(entries.map((e) => e.id));
    const result = compile(entries, { tokenBudget: 10000 });
    for (const e of result.entries) {
      expect(inputIds.has(e.id)).toBe(true);
    }
  });

  it('no duplicate entry ids in output', () => {
    const entries = [e1, e2, e3];
    const result = compile(entries, { tokenBudget: 10000 });
    const ids = result.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('deterministic: same input produces same output', () => {
    const entries = [e1, e2, e3];
    const r1 = compile(entries, {
      tokenBudget: 500,
      taskPromptEmbedding: [1, 0, 0],
    });
    const r2 = compile(entries, {
      tokenBudget: 500,
      taskPromptEmbedding: [1, 0, 0],
    });
    expect(r1.entries.map((e) => e.id)).toEqual(r2.entries.map((e) => e.id));
    expect(r1.trace.taskPromptHash).toBe(r2.trace.taskPromptHash);
  });

  it('compile then enforceBudget on same ranked order produces same result', () => {
    // Simulates the Phase 2 workflow: compile produces MMR order,
    // then enforceBudget is called again after a (no-op) LLM step
    const entries = [e1, e2, e3];
    const compiled = compile(entries, {
      tokenBudget: 10000,
      taskPromptEmbedding: [1, 0, 0],
    });
    // Re-fetch entries in the order compile ranked them
    const rankedIds = compiled.entries.map((e) => e.id);
    const rankedEntries = rankedIds.map(
      (id) => entries.find((e) => e.id === id)!,
    );
    const reEnforced = enforceBudget(rankedEntries, 10000);
    expect(reEnforced.entries.map((e) => e.id)).toEqual(rankedIds);
  });
});
