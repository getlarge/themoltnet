import type { CompiledEntry, CompressionLevel, DistillEntry } from './types.js';

/** Rough token estimate: ~0.75 words per token (GPT-family approximation). */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  return Math.ceil(words.length / 0.75);
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
    const content = extractiveSummary(entry.content, 0.3);
    return {
      id: entry.id,
      content,
      compressionLevel: 'summary',
      originalTokens,
      compressedTokens: estimateTokens(content),
    };
  }

  // keywords
  const content = extractKeywords(entry.content);
  return {
    id: entry.id,
    content,
    compressionLevel: 'keywords',
    originalTokens,
    compressedTokens: estimateTokens(content),
  };
}

/**
 * Keep top fraction of sentences by position+length scoring.
 * Sentences returned in original order.
 */
function extractiveSummary(text: string, keepFraction: number): string {
  const sentences = splitSentences(text);
  if (sentences.length <= 2) return text;

  const keepCount = Math.max(1, Math.ceil(sentences.length * keepFraction));

  const scored = sentences.map((sentence, i) => ({
    sentence,
    originalIndex: i,
    score: positionScore(i, sentences.length) + lengthScore(sentence),
  }));

  const kept = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, keepCount)
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map((s) => s.sentence);

  return kept.join(' ');
}

/** Prefer earlier sentences: position 0 → score 1, last → score 0. */
function positionScore(index: number, total: number): number {
  return 1 - index / total;
}

/** Prefer longer sentences (normalized to [0,1]). */
function lengthScore(sentence: string): number {
  return Math.min(sentence.length / 200, 1);
}

/** Maximum token output for keyword compression. */
const KEYWORDS_TOKEN_CAP = 30;

/**
 * Extract identifiers and significant words.
 * Keeps: words ≥4 chars, CamelCase tokens, words with digits.
 * Deduplicates (case-insensitive) and caps output at KEYWORDS_TOKEN_CAP tokens.
 */
function extractKeywords(content: string): string {
  if (!content.trim()) return '';

  const words = content.split(/\s+/);
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const raw of words) {
    const word = raw.replace(/[^\w./-]/g, '');
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;

    const isSignificant =
      word.length >= 4 ||
      /[a-z][A-Z]/.test(word) || // CamelCase (lower→upper transition)
      /\d/.test(word); // version numbers, identifiers

    if (isSignificant) {
      // Check token budget before adding: skip (don't break) so we can still
      // pick up short significant words that fit in the remaining budget.
      if (estimateTokens([...keywords, word].join(' ')) > KEYWORDS_TOKEN_CAP) {
        continue;
      }
      seen.add(key);
      keywords.push(word);
    }
  }

  return keywords.join(' ');
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
