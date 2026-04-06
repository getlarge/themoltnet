/* eslint-disable no-console */
/**
 * Benchmark: Embedding service cold vs warm latency.
 *
 * Demonstrates the cost of lazy pipeline initialization on first call
 * (loading onnxruntime-node + model from disk) versus subsequent warm calls.
 *
 * Usage (from repo root):
 *   pnpm --filter @moltnet/tools bench:embedding
 *   pnpm --filter @moltnet/tools bench:embedding -- --iterations=10
 *   EMBEDDING_CACHE_DIR=./models pnpm --filter @moltnet/tools bench:embedding
 *
 * Related: https://github.com/getlarge/themoltnet/issues/621
 */

import { createEmbeddingService } from '@moltnet/embedding-service';

// ── Config ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const iterations = parseInt(
  args.find((a) => a.startsWith('--iterations='))?.split('=')[1] ?? '5',
  10,
);
const cacheDir = process.env.EMBEDDING_CACHE_DIR;
const allowRemoteModels = process.env.EMBEDDING_ALLOW_REMOTE_MODELS !== 'false';

const logger = {
  info: (obj: unknown, msg?: string) =>
    console.log(`  [info] ${msg ?? ''}`, obj),
  warn: (obj: unknown, msg?: string) =>
    console.warn(`  [warn] ${msg ?? ''}`, obj),
  error: (obj: unknown, msg?: string) =>
    console.error(`  [error] ${msg ?? ''}`, obj),
  debug: () => {},
};

// ── Main ────────────────────────────────────────────────────────────────────

console.log(`\nEmbedding warmup benchmark`);
console.log(`  Model: Xenova/e5-small-v2 (q8, onnxruntime-node)`);
if (cacheDir) console.log(`  Cache dir: ${cacheDir}`);
console.log(`  Iterations: ${iterations} (first = cold)\n`);

const embeddingService = createEmbeddingService({
  cacheDir,
  allowRemoteModels,
  logger,
});

const sampleTexts = [
  'Agent identity bootstrap sequence for MoltNet network registration.',
  'Diary entry containing observations about collaborative task completion.',
  'OAuth2 client credentials flow with JWT webhook enrichment.',
  'Context pack compilation with semantic clustering and relevance scoring.',
  'Keto relationship tuple granting entry parent to diary namespace.',
];

const durations: number[] = [];

for (let i = 0; i < iterations; i++) {
  const text = sampleTexts[i % sampleTexts.length];
  const start = performance.now();
  const embedding = await embeddingService.embedPassage(text);
  const elapsed = performance.now() - start;
  durations.push(elapsed);

  const label = i === 0 ? '(cold)' : '(warm)';
  console.log(
    `  #${String(i + 1).padStart(2)}  ${label.padEnd(7)} ${elapsed.toFixed(0).padStart(6)}ms  dims=${embedding.length}`,
  );
}

// ── Summary ─────────────────────────────────────────────────────────────────

const cold = durations[0];
const warmDurations = durations.slice(1);
const warmAvg = warmDurations.reduce((s, d) => s + d, 0) / warmDurations.length;
const warmP50 = [...warmDurations].sort((a, b) => a - b)[
  Math.floor(warmDurations.length * 0.5)
];

console.log(`\n  ── Summary ──`);
console.log(`  Cold (first call):  ${cold.toFixed(0)}ms`);
console.log(
  `  Warm avg:           ${warmAvg.toFixed(0)}ms  (p50: ${warmP50.toFixed(0)}ms)`,
);
console.log(`  Cold/warm ratio:    ${(cold / warmAvg).toFixed(1)}x slower`);
console.log(
  `  Startup warm-up would hide ${cold.toFixed(0)}ms from user-facing requests.`,
);
