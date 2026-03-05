import { describe, expect, it } from 'vitest';

import { compress, estimateTokens } from '../src/compress.js';
import type { DistillEntry } from '../src/types.js';

function makeEntry(
  id: string,
  content: string,
  embedding: number[] = [1, 0, 0],
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

const codeContent = [
  'The agglomerative clustering algorithm groups diary entries.',
  'It uses cosine distance between 384-dimensional embeddings.',
  'CamelCase identifiers like DistillEntry are preserved.',
  'Version numbers such as v2.0.0 should also survive.',
].join(' ');

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns positive count for non-empty text', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
  });

  it('longer text has more tokens than shorter', () => {
    expect(estimateTokens(longContent)).toBeGreaterThan(
      estimateTokens('hello'),
    );
  });

  it('result is an integer', () => {
    const t = estimateTokens('some words here');
    expect(Number.isInteger(t)).toBe(true);
  });

  it('single word returns positive integer', () => {
    expect(estimateTokens('hello')).toBeGreaterThan(0);
    expect(Number.isInteger(estimateTokens('hello'))).toBe(true);
  });

  it('whitespace-only string returns 0', () => {
    expect(estimateTokens('   ')).toBe(0);
  });

  it('approximates token count correctly (GPT-family ~0.75 words/token)', () => {
    // 3 words => ceil(3 / 0.75) = 4
    expect(estimateTokens('one two three')).toBe(4);
  });

  it('handles newlines and tabs as whitespace', () => {
    const multiline = 'word1\nword2\tword3';
    expect(estimateTokens(multiline)).toBeGreaterThan(0);
    expect(Number.isInteger(estimateTokens(multiline))).toBe(true);
  });
});

describe('compress — full level', () => {
  it('returns original content unchanged', () => {
    const e = makeEntry('a', 'Hello world.');
    const result = compress(e, 'full');
    expect(result.content).toBe('Hello world.');
    expect(result.compressionLevel).toBe('full');
  });

  it('compressedTokens equals originalTokens', () => {
    const e = makeEntry('a', 'Hello world.');
    const result = compress(e, 'full');
    expect(result.compressedTokens).toBe(result.originalTokens);
  });

  it('id is preserved', () => {
    const e = makeEntry('my-id', 'Some content.');
    expect(compress(e, 'full').id).toBe('my-id');
  });

  it('originalTokens matches entry.tokens', () => {
    const e = makeEntry('a', 'Some content here.');
    const result = compress(e, 'full');
    expect(result.originalTokens).toBe(e.tokens);
  });

  it('handles empty content', () => {
    const e = makeEntry('a', '');
    e.tokens = 0;
    const result = compress(e, 'full');
    expect(result.content).toBe('');
    expect(result.compressedTokens).toBe(0);
    expect(result.originalTokens).toBe(0);
  });

  it('handles multi-paragraph content unchanged', () => {
    const multiPara = 'First paragraph.\n\nSecond paragraph.';
    const e = makeEntry('a', multiPara);
    expect(compress(e, 'full').content).toBe(multiPara);
  });
});

describe('compress — summary level', () => {
  it('reduces token count for long content', () => {
    const e = makeEntry('a', longContent);
    const result = compress(e, 'summary');
    expect(result.compressedTokens).toBeLessThan(result.originalTokens);
  });

  it('compressionLevel is summary', () => {
    const e = makeEntry('a', longContent);
    expect(compress(e, 'summary').compressionLevel).toBe('summary');
  });

  it('output is non-empty', () => {
    const e = makeEntry('a', longContent);
    expect(compress(e, 'summary').content.length).toBeGreaterThan(0);
  });

  it('short content (≤2 sentences) is returned as-is', () => {
    const short = 'One sentence only.';
    const e = makeEntry('a', short);
    expect(compress(e, 'summary').content).toBe(short);
  });

  it('two sentences returned as-is', () => {
    const two = 'First sentence. Second sentence.';
    const e = makeEntry('a', two);
    expect(compress(e, 'summary').content).toBe(two);
  });

  it('originalTokens reflects entry.tokens not compressed size', () => {
    const e = makeEntry('a', longContent);
    expect(compress(e, 'summary').originalTokens).toBe(e.tokens);
  });

  it('preserves sentence order in output', () => {
    // Build content where sentence A comes before B
    const ordered =
      'Alpha sentence comes first. Beta sentence comes second. Gamma is third. Delta is fourth. Epsilon fifth.';
    const e = makeEntry('a', ordered);
    const result = compress(e, 'summary');
    // Whatever sentences are kept, they must appear in original order
    const sentences = result.content.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 1) {
      const firstIdx = ordered.indexOf(sentences[0]);
      const secondIdx = ordered.indexOf(sentences[1]);
      expect(firstIdx).toBeLessThan(secondIdx);
    }
  });

  it('id is preserved', () => {
    const e = makeEntry('summary-id', longContent);
    expect(compress(e, 'summary').id).toBe('summary-id');
  });

  it('compressedTokens is accurate for output content', () => {
    const e = makeEntry('a', longContent);
    const result = compress(e, 'summary');
    expect(result.compressedTokens).toBe(estimateTokens(result.content));
  });

  it('keeps at least one sentence for content with many sentences', () => {
    const e = makeEntry('a', longContent);
    const result = compress(e, 'summary');
    expect(result.content.trim().length).toBeGreaterThan(0);
  });

  it('handles content with exclamation and question marks as sentence boundaries', () => {
    const mixed =
      'Is this a question? Yes it is! And here is a statement. One more follows. Fifth is here. Sixth appears.';
    const e = makeEntry('a', mixed);
    const result = compress(e, 'summary');
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.compressionLevel).toBe('summary');
  });

  it('output sentences are a subset of input sentences', () => {
    const sentences = [
      'First sentence has some content.',
      'Second sentence mentions something else.',
      'Third is here.',
      'Fourth follows.',
      'Fifth is long and detailed with many words to score highly.',
      'Sixth adds more noise to the corpus.',
      'Seventh and final sentence completes it.',
    ];
    const e = makeEntry('a', sentences.join(' '));
    const result = compress(e, 'summary');
    const outputSentences = result.content
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean);
    for (const s of outputSentences) {
      expect(sentences).toContain(s);
    }
  });

  it('10-sentence input keeps ceil(10 * 0.3) = 3 sentences', () => {
    const tenSentences = Array.from(
      { length: 10 },
      (_, i) => `Sentence ${i} contains words about topic ${i}.`,
    ).join(' ');
    const e = makeEntry('a', tenSentences);
    const result = compress(e, 'summary');
    // split on sentence boundaries to count
    const kept = result.content.split(/(?<=[.!?])\s+/).filter(Boolean);
    expect(kept).toHaveLength(3);
  });
});

describe('compress — keywords level', () => {
  it('compressionLevel is keywords', () => {
    const e = makeEntry('a', codeContent);
    expect(compress(e, 'keywords').compressionLevel).toBe('keywords');
  });

  it('output is non-empty for non-trivial content', () => {
    const e = makeEntry('a', codeContent);
    expect(compress(e, 'keywords').content.length).toBeGreaterThan(0);
  });

  it('produces fewer tokens than summary', () => {
    const e = makeEntry('a', longContent);
    const summary = compress(e, 'summary');
    const keywords = compress(e, 'keywords');
    expect(keywords.compressedTokens).toBeLessThanOrEqual(
      summary.compressedTokens,
    );
  });

  it('preserves CamelCase identifiers', () => {
    const e = makeEntry('a', codeContent);
    const result = compress(e, 'keywords');
    expect(result.content).toMatch(/DistillEntry/);
  });

  it('preserves version numbers', () => {
    const e = makeEntry('a', codeContent);
    const result = compress(e, 'keywords');
    expect(result.content).toMatch(/v2\.0\.0/);
  });

  it('deduplicates repeated words', () => {
    const repeated =
      'clustering clustering clustering distance distance algorithm';
    const e = makeEntry('a', repeated);
    const result = compress(e, 'keywords');
    const words = result.content.split(' ');
    const unique = new Set(words.map((w) => w.toLowerCase()));
    expect(words.length).toBe(unique.size);
  });

  it('caps output at 30 tokens', () => {
    const e = makeEntry('a', longContent);
    const result = compress(e, 'keywords');
    expect(result.compressedTokens).toBeLessThanOrEqual(30);
  });

  it('handles empty content gracefully', () => {
    const e = makeEntry('a', '');
    e.tokens = 0;
    const result = compress(e, 'keywords');
    expect(result.content).toBe('');
    expect(result.compressedTokens).toBe(0);
  });

  it('id is preserved', () => {
    const e = makeEntry('kw-id', codeContent);
    expect(compress(e, 'keywords').id).toBe('kw-id');
  });

  it('originalTokens reflects entry.tokens', () => {
    const e = makeEntry('a', codeContent);
    expect(compress(e, 'keywords').originalTokens).toBe(e.tokens);
  });

  it('compressedTokens is accurate for output content', () => {
    const e = makeEntry('a', codeContent);
    const result = compress(e, 'keywords');
    expect(result.compressedTokens).toBe(estimateTokens(result.content));
  });

  it('filters out short stop-words (len < 4)', () => {
    // "the", "is", "it", "are", "by" — all < 4 chars, none CamelCase, no digits
    const stopWords = 'the cat is on a mat by the door';
    const e = makeEntry('a', stopWords);
    const result = compress(e, 'keywords');
    // Only words >= 4 chars survive: none here except... let's check
    // "door" has 4 chars, "mat" has 3 — only "door" passes
    const words = result.content ? result.content.split(' ') : [];
    for (const w of words) {
      // Each surviving word must satisfy significance criteria
      const isSignificant =
        w.length >= 4 || /[A-Z][a-z]/.test(w) || /\d/.test(w);
      expect(isSignificant).toBe(true);
    }
  });

  it('handles whitespace-only content', () => {
    const e = makeEntry('a', '   ');
    e.tokens = 0;
    const result = compress(e, 'keywords');
    expect(result.content).toBe('');
    expect(result.compressedTokens).toBe(0);
  });

  it('word cap: stops after 30 keywords even with more content', () => {
    // 50 unique significant words
    const manyWords = Array.from({ length: 50 }, (_, i) => `word${i}here`).join(
      ' ',
    );
    const e = makeEntry('a', manyWords);
    const result = compress(e, 'keywords');
    const words = result.content ? result.content.split(' ') : [];
    expect(words.length).toBeLessThanOrEqual(30);
  });
});
