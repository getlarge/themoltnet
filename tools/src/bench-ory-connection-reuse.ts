/* eslint-disable no-console */
/**
 * Benchmark: Ory Keto API latency with the runtime default HTTP transport
 * versus a custom undici Agent configuration.
 *
 * On Node 18+, fetch() is backed by undici and already reuses connections by
 * default. This benchmark measures whether providing an explicit undici Agent
 * changes latency characteristics for Ory API calls.
 *
 * Tests both read (checkPermission) and write (createRelationship) operations
 * since the production bottleneck is grantEntryParent (a write).
 *
 * Usage (from repo root):
 *   pnpm --filter @moltnet/tools bench:ory
 *   pnpm --filter @moltnet/tools bench:ory -- --iterations=20 --verbose
 *
 * Requires ORY_PROJECT_URL and ORY_PROJECT_API_KEY (loaded via dotenvx).
 *
 * Related: https://github.com/getlarge/themoltnet/issues/620
 */

import { randomUUID } from 'node:crypto';

import { config } from '@dotenvx/dotenvx';
import {
  Configuration,
  type FetchAPI,
  PermissionApi,
  RelationshipApi,
} from '@ory/client-fetch';
import { Agent as UndiciAgent } from 'undici';

// ── Config ──────────────────────────────────────────────────────────────────

config({ path: ['.env', 'env.public'], override: true });

const oryProjectUrl = process.env.ORY_PROJECT_URL;
const oryApiKey = process.env.ORY_PROJECT_API_KEY;

if (!oryProjectUrl) {
  console.error('ORY_PROJECT_URL not set');
  process.exit(1);
}
if (!oryApiKey || oryApiKey.startsWith('encrypted:')) {
  console.error(
    'ORY_PROJECT_API_KEY not set or still encrypted — check DOTENV_PRIVATE_KEY',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const iterations = parseInt(
  args.find((a) => a.startsWith('--iterations='))?.split('=')[1] ?? '10',
  10,
);
const verbose = args.includes('--verbose');

// ── Helpers ─────────────────────────────────────────────────────────────────

interface OryClients {
  permission: PermissionApi;
  relationship: RelationshipApi;
}

function makeClients(fetchApi?: FetchAPI): OryClients {
  const cfg = new Configuration({
    basePath: oryProjectUrl,
    accessToken: oryApiKey,
    ...(fetchApi ? { fetchApi } : {}),
  });
  return {
    permission: new PermissionApi(cfg),
    relationship: new RelationshipApi(cfg),
  };
}

// Read operation — checkPermission (GET)
async function runRead(api: PermissionApi): Promise<void> {
  try {
    await api.checkPermission({
      namespace: 'Diary',
      object: 'bench-nonexistent',
      relation: 'read',
      subjectId: 'bench-nonexistent',
    });
  } catch {
    // 403/404 are expected — we only care about latency
  }
}

// Write operation — createRelationship (PUT), mirrors grantEntryParent
const benchNamespace = 'DiaryEntry';
const benchRelation = 'parent';
const benchDiaryId = 'bench-diary-' + randomUUID().slice(0, 8);
const createdTuples: string[] = [];

async function runWrite(api: RelationshipApi): Promise<void> {
  const entryId = 'bench-entry-' + randomUUID().slice(0, 8);
  await api.createRelationship({
    createRelationshipBody: {
      namespace: benchNamespace,
      object: entryId,
      relation: benchRelation,
      subject_set: {
        namespace: 'Diary',
        object: benchDiaryId,
        relation: '',
      },
    },
  });
  createdTuples.push(entryId);
}

// Write operation — simple namespace (Agent#self, no subject_set indirection)
const simpleAgentIds: string[] = [];

async function runWriteSimple(api: RelationshipApi): Promise<void> {
  const agentId = 'bench-agent-' + randomUUID().slice(0, 8);
  await api.createRelationship({
    createRelationshipBody: {
      namespace: 'Agent',
      object: agentId,
      relation: 'self',
      subject_id: agentId,
    },
  });
  simpleAgentIds.push(agentId);
}

// Cleanup — delete all benchmark tuples
async function cleanup(api: RelationshipApi): Promise<void> {
  const jobs: Promise<void>[] = [];
  if (createdTuples.length > 0) {
    jobs.push(
      api
        .deleteRelationships({
          namespace: benchNamespace,
          relation: benchRelation,
          subjectSetNamespace: 'Diary',
          subjectSetObject: benchDiaryId,
          subjectSetRelation: '',
        })
        .then(() => void 0),
    );
  }
  for (const agentId of simpleAgentIds) {
    jobs.push(
      api
        .deleteRelationships({
          namespace: 'Agent',
          object: agentId,
          relation: 'self',
          subjectId: agentId,
        })
        .then(() => void 0),
    );
  }
  if (jobs.length > 0) {
    console.log(
      `\n  Cleaning up ${createdTuples.length + simpleAgentIds.length} benchmark tuples...`,
    );
    await Promise.all(jobs);
    console.log('  Done.');
  }
}

interface Stats {
  avg: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
}

function computeStats(durations: number[]): Stats {
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((s, d) => s + d, 0);
  return {
    avg: sum / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function fmt(ms: number): string {
  return `${ms.toFixed(0)}ms`;
}

function printStats(label: string, stats: Stats): void {
  console.log(
    `  ${label.padEnd(30)} avg=${fmt(stats.avg)}  p50=${fmt(stats.p50)}  p95=${fmt(stats.p95)}  min=${fmt(stats.min)}  max=${fmt(stats.max)}`,
  );
}

async function benchmark(
  label: string,
  fn: () => Promise<void>,
  n: number,
): Promise<Stats> {
  const durations: number[] = [];

  // Warm-up call (excluded from stats)
  await fn();

  for (let i = 0; i < n; i++) {
    const start = performance.now();
    await fn();
    const elapsed = performance.now() - start;
    durations.push(elapsed);
    if (verbose) {
      console.log(`    #${String(i + 1).padStart(2)}  ${fmt(elapsed)}`);
    }
  }

  const stats = computeStats(durations);
  printStats(label, stats);
  return stats;
}

function printSummary(
  label: string,
  defaultStats: Stats,
  keepAliveStats: Stats,
): void {
  const savedAvg = defaultStats.avg - keepAliveStats.avg;
  const savedP50 = defaultStats.p50 - keepAliveStats.p50;
  const pctAvg = ((savedAvg / defaultStats.avg) * 100).toFixed(1);
  const pctP50 = ((savedP50 / defaultStats.p50) * 100).toFixed(1);
  console.log(
    `  ${label.padEnd(30)} avg: ${fmt(savedAvg)} (${pctAvg}%)  p50: ${fmt(savedP50)} (${pctP50}%)`,
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log(`\nOry Keto connection reuse benchmark`);
console.log(`  Target: ${oryProjectUrl}`);
console.log(`  Iterations: ${iterations} (+ 1 warm-up each)\n`);

const defaultClients = makeClients();

const dispatcher = new UndiciAgent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 120_000,
  connections: 10,
  pipelining: 1,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const keepAliveFetch: FetchAPI = (input: any, init?: any) =>
  fetch(input, { ...init, dispatcher });
const keepAliveClients = makeClients(keepAliveFetch);

// ── Read (checkPermission — GET) ────────────────────────────────────────────

console.log('  ── READ (checkPermission) ──');
const readDefault = await benchmark(
  'Default fetch',
  () => runRead(defaultClients.permission),
  iterations,
);
const readKeepAlive = await benchmark(
  'Undici Agent (keepAlive)',
  () => runRead(keepAliveClients.permission),
  iterations,
);

// ── Write: DiaryEntry#parent (subject_set, complex namespace) ───────────────

console.log('\n  ── WRITE: DiaryEntry#parent (subject_set) ──');
const writeComplexDefault = await benchmark(
  'Default fetch',
  () => runWrite(defaultClients.relationship),
  iterations,
);
const writeComplexKeepAlive = await benchmark(
  'Undici Agent (keepAlive)',
  () => runWrite(keepAliveClients.relationship),
  iterations,
);

// ── Write: Agent#self (subject_id, simple namespace) ────────────────────────

console.log('\n  ── WRITE: Agent#self (subject_id) ──');
const writeSimpleDefault = await benchmark(
  'Default fetch',
  () => runWriteSimple(defaultClients.relationship),
  iterations,
);
const writeSimpleKeepAlive = await benchmark(
  'Undici Agent (keepAlive)',
  () => runWriteSimple(keepAliveClients.relationship),
  iterations,
);

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n  ── Connection reuse savings ──`);
printSummary('Read', readDefault, readKeepAlive);
printSummary('Write (DiaryEntry)', writeComplexDefault, writeComplexKeepAlive);
printSummary('Write (Agent)', writeSimpleDefault, writeSimpleKeepAlive);

console.log(`\n  ── Namespace complexity comparison (default fetch) ──`);
printSummary(
  'DiaryEntry vs Agent write',
  writeComplexDefault,
  writeSimpleDefault,
);

// ── Cleanup ─────────────────────────────────────────────────────────────────

await cleanup(keepAliveClients.relationship);
await dispatcher.close();
