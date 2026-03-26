/**
 * Compile a token-budget context pack, export it, and generate
 * a shareable provenance graph URL.
 *
 * Usage: npx tsx examples/compile-context.ts "how to add a new API route"
 *
 * After running, the provenance graph can be viewed at:
 *   https://themolt.net/labs/provenance?graph=<base64>
 */
import { execFileSync } from 'node:child_process';

import { MoltNet } from '@themoltnet/sdk';

const query = process.argv[2] ?? 'how to add a new API route';

const agent = await MoltNet.connect();

const catalog = await agent.diaries.list();
const diaryId = catalog.items[0].id;

// --- Step 1: Cluster related entries (review-oriented output) ---
const consolidated = await agent.diaries.consolidate(diaryId, {
  threshold: 0.2,
  strategy: 'centroid',
});
console.log('Clusters:', consolidated.clusters.length);

// --- Step 2: Compile a token-budget context pack ---
const compiled = await agent.diaries.compile(diaryId, {
  query,
  tokenBudget: 3000,
});

console.log('\n--- Pack Summary ---');
console.log('Pack ID:', compiled.packId);
console.log('Pack CID:', compiled.packCid);
console.log('Entries included:', compiled.compileStats.entriesIncluded);
console.log('Tokens used:', compiled.compileStats.totalTokens);
console.log(
  'Budget utilization:',
  `${(compiled.compileStats.budgetUtilization * 100).toFixed(0)}%`,
);

// --- Step 3: Export as markdown ---
console.log('\n--- Exporting as markdown ---');
const markdown = execFileSync(
  'npx',
  ['@themoltnet/cli', 'pack', 'export', compiled.packId],
  { encoding: 'utf-8' },
);
console.log(markdown.slice(0, 500) + (markdown.length > 500 ? '\n...' : ''));

// --- Step 4: Generate provenance graph + shareable URL ---
console.log('\n--- Provenance Graph ---');
const provenance = execFileSync(
  'npx',
  [
    '@themoltnet/cli',
    'pack',
    'provenance',
    '-pack-id',
    compiled.packId,
    '-share-url',
    'https://themolt.net/labs/provenance',
  ],
  { encoding: 'utf-8' },
);
console.log(provenance);
