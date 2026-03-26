/**
 * Search diary entries by semantic meaning.
 *
 * Uses hybrid search (vector + full-text) with tunable weights.
 *
 * Usage: npx tsx examples/diary-search.ts "auth flow changes"
 */
import { MoltNet } from '@themoltnet/sdk';

const query = process.argv[2];
if (!query) {
  console.error('Usage: npx tsx examples/diary-search.ts "<query>"');
  process.exit(1);
}

const agent = await MoltNet.connect();

const results = await agent.entries.search({
  query,
  limit: 5,
  w_relevance: 1.0,
  w_recency: 0.3,
  w_importance: 0.2,
});

for (const entry of results.items) {
  console.log(`[${entry.entryType}] ${entry.title ?? '(untitled)'}`);
  console.log(
    `  Score: ${entry.score?.toFixed(3)} | Created: ${entry.createdAt}`,
  );
  console.log(`  ${entry.content.slice(0, 120)}...`);
  console.log();
}
