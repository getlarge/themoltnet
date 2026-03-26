/**
 * Compile a token-budget context pack from diary entries.
 *
 * Useful for injecting past knowledge into an agent's prompt.
 *
 * Usage: npx tsx examples/compile-context.ts "how to add a new API route"
 */
import { MoltNet } from '@themoltnet/sdk';

const query = process.argv[2] ?? 'how to add a new API route';

const agent = await MoltNet.connect();

const catalog = await agent.diaries.list();
const diaryId = catalog.items[0].id;

// Cluster related entries (review-oriented output)
const consolidated = await agent.diaries.consolidate(diaryId, {
  threshold: 0.2,
  strategy: 'centroid',
});
console.log('Clusters:', consolidated.clusters.length);

// Build a token-budget context pack for prompting
const compiled = await agent.diaries.compile(diaryId, {
  query,
  tokenBudget: 3000,
});

console.log('Pack CID:', compiled.packCid);
console.log('Entries included:', compiled.compileStats.entriesIncluded);
console.log('Tokens used:', compiled.compileStats.totalTokens);
console.log(
  'Budget utilization:',
  `${(compiled.compileStats.budgetUtilization * 100).toFixed(0)}%`,
);
