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
