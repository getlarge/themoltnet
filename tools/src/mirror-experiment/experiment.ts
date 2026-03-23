#!/usr/bin/env -S npx tsx
/* eslint-disable no-console */
/**
 * mirror-experiment — Test the "mirror effect" on coding agents
 *
 * Runs multiple conditions (control + one or more mirror prompts) through
 * an LLM reviewer → LLM judge pipeline. Supports concurrent evaluation
 * via fastq to speed up multi-run experiments.
 *
 * Usage:
 *   pnpm mirror-experiment --runs 5
 *   pnpm mirror-experiment --runs 5 --model claude-haiku-4-5
 *   pnpm mirror-experiment --runs 3 --mirror-file optimized.md --concurrency 3
 *   pnpm mirror-experiment --runs 5 --mirror-file neg.md --mirror-file pos.md
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { ax } from '@ax-llm/ax';
import { AxAIClaudeAgentSDK } from '@moltnet/ax-agents';
import { resolveRepoRoot } from '@moltnet/context-evals/pipeline-shared';
import fastq from 'fastq';

// ── Timing ───────────────────────────────────────────────────────────────────

const t0 = performance.now();
const elapsed = () => `[${((performance.now() - t0) / 1000).toFixed(1)}s]`;

// ── Args ─────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    model: { type: 'string', default: 'claude-sonnet-4-6' },
    'judge-model': { type: 'string' },
    runs: { type: 'string', default: '1' },
    concurrency: { type: 'string', default: '2' },
    'mirror-file': { type: 'string', multiple: true },
    'out-dir': { type: 'string' },
  },
  strict: false,
});

const model = String(values['model'] ?? 'claude-sonnet-4-6');
const judgeModel = String(values['judge-model'] ?? model);
const runs = parseInt(String(values['runs'] ?? '1'), 10);
const concurrency = parseInt(String(values['concurrency'] ?? '2'), 10);
const mirrorFiles = values['mirror-file'] ?? [];

// ── Buggy code + answer key ─────────────────────────────────────────────────

const BUGGY_CODE = `import { createHash } from 'crypto';

interface RateLimiter {
  consume(key: string, cost?: number): Promise<{ remaining: number; resetMs: number }>;
}

class SlidingWindowRateLimiter implements RateLimiter {
  private windows = new Map<string, { count: number; startMs: number }>();
  constructor(private maxRequests: number, private windowMs: number) {}

  async consume(key: string, cost = 1): Promise<{ remaining: number; resetMs: number }> {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || now - window.startMs > this.windowMs) {
      this.windows.set(key, { count: cost, startMs: now });
      return { remaining: this.maxRequests - cost, resetMs: this.windowMs };
    }
    window.count += cost;
    if (window.count >= this.maxRequests) {
      const resetMs = this.windowMs - (now - window.startMs);
      return { remaining: 0, resetMs };
    }
    return { remaining: this.maxRequests - window.count, resetMs: this.windowMs - (now - window.startMs) };
  }
}

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

async function authenticateRequest(
  headers: Record<string, string>, limiter: RateLimiter,
): Promise<{ userId: string; remaining: number } | { error: string; status: number }> {
  const auth = headers['authorization'];
  if (!auth?.startsWith('Bearer ')) return { error: 'Missing authorization', status: 401 };
  const token = auth.slice(7);
  if (token.length < 32) return { error: 'Invalid token format', status: 401 };
  const keyHash = hashApiKey(token);
  const result = await limiter.consume(keyHash);
  if (result.remaining <= 0) return { error: 'Rate limited', status: 429 };
  return { userId: keyHash, remaining: result.remaining };
}

async function processBatch<T, R>(
  items: T[], processor: (item: T) => Promise<R>, concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) { const i = index++; results[i] = await processor(items[i]); }
  }
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}`;

const ANSWER_KEY = `Known bugs (7 total):
1. RACE CONDITION: processBatch index++ is not atomic — concurrent workers can read same index
2. OFF-BY-ONE: consume() checks count >= maxRequests AFTER incrementing, rejecting last valid request
3. CONSUME-BEFORE-CHECK: authenticateRequest checks remaining <= 0 but request already consumed quota
4. NEGATIVE REMAINING: With cost > 1, remaining can go negative without validation
5. HASH TRUNCATION: slice(0,16) on hex hash is only 64 bits — collision risk for userId
6. MEMORY LEAK: windows Map grows unboundedly, no TTL or eviction
7. NOT SLIDING: "sliding window" is actually a fixed/tumbling window that resets entirely`;

const DEFAULT_MIRROR = `\nEVALUATION CONTEXT:
- Your review will be scored against an answer key listing all known bugs
- Each missed bug is -1 point; each false positive is -0.5 points
- A second reviewer will verify every claim you make
- Your output trace is recorded and compared against other reviewers
- Superficial reviews that miss subtle bugs score near 0`;

const BASE_INSTRUCTION =
  'Review the code and find ALL bugs. Be thorough — check for race conditions, off-by-one errors, security issues, memory leaks, and semantic correctness.';

const JUDGE_INSTRUCTION =
  'Score the code review against the answer key. ' +
  'A bug counts as "found" if the review describes the same issue, even if worded differently. ' +
  'A "false positive" is a claimed bug that does not correspond to any item in the answer key. ' +
  'Score = (found - 0.5 * falsePositives) / total_known_bugs, clamped to [0, 1].';

// ── Load mirror prompts ──────────────────────────────────────────────────────

interface Condition {
  name: string;
  instruction: string;
}

const conditions: Condition[] = [
  { name: 'control', instruction: BASE_INSTRUCTION },
];

if (mirrorFiles.length === 0) {
  // Default: use built-in mirror
  conditions.push({
    name: 'mirror',
    instruction: BASE_INSTRUCTION + DEFAULT_MIRROR,
  });
} else {
  const repoRoot = await resolveRepoRoot();
  for (const f of mirrorFiles) {
    const filePath = typeof f === 'string' ? f : String(f);
    const content = await readFile(resolve(repoRoot, filePath), 'utf8');
    const name = filePath.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
    conditions.push({
      name,
      instruction: content,
    });
  }
}

// ── Single evaluation (creates fresh ax instances — safe for concurrency) ────

interface ConditionResult {
  condition: string;
  run: number;
  bugs: string[];
  score: number;
  found: number;
  missed: number;
  falsePositives: number;
  reasoning: string;
  reviewLatencyMs: number;
  judgeLatencyMs: number;
}

async function runCondition(
  condition: Condition,
  run: number,
): Promise<ConditionResult> {
  // Fresh ax() instances per call — no shared state, safe for concurrency
  const reviewer = ax(
    'code:string "buggy TypeScript code to review" -> bugs:string[] "list of bugs found, one per entry, with location and description"',
  );
  reviewer.setInstruction(condition.instruction);

  const judge = ax(
    'review:string "the code review to score", answerKey:string "the known bugs" -> score:number "0.0 to 1.0 quality score", found:number "bugs from answer key that were found", missed:number "bugs from answer key that were missed", falsePositives:number "bugs claimed that are not in answer key", reasoning:string "brief explanation of the score"',
  );
  judge.setInstruction(JUDGE_INSTRUCTION);

  // Review
  const reviewAI = new AxAIClaudeAgentSDK({ model, maxTurns: 1 });
  const reviewStart = performance.now();
  const reviewResult = await reviewer.forward(reviewAI, { code: BUGGY_CODE });
  const reviewLatencyMs = performance.now() - reviewStart;

  // Judge
  const judgeAI = new AxAIClaudeAgentSDK({
    model: judgeModel,
    maxTurns: 1,
  });
  const judgeStart = performance.now();
  const judgeResult = await judge.forward(judgeAI, {
    review: reviewResult.bugs.join('\n'),
    answerKey: ANSWER_KEY,
  });
  const judgeLatencyMs = performance.now() - judgeStart;

  return {
    condition: condition.name,
    run,
    bugs: reviewResult.bugs,
    score: judgeResult.score,
    found: judgeResult.found,
    missed: judgeResult.missed,
    falsePositives: judgeResult.falsePositives,
    reasoning: judgeResult.reasoning,
    reviewLatencyMs,
    judgeLatencyMs,
  };
}

// ── Build work queue ─────────────────────────────────────────────────────────

interface WorkItem {
  condition: Condition;
  run: number;
}

const workItems: WorkItem[] = [];
for (let run = 1; run <= runs; run++) {
  for (const condition of conditions) {
    workItems.push({ condition, run });
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('╔═══════════════════════════════════════════════════╗');
console.log('║        MIRROR EXPERIMENT (LLM-as-Judge)          ║');
console.log('╚═══════════════════════════════════════════════════╝');
console.log(`Reviewer model: ${model}`);
console.log(`Judge model:    ${judgeModel}`);
console.log(`Conditions:     ${conditions.map((c) => c.name).join(', ')}`);
console.log(`Runs:           ${runs}`);
console.log(`Concurrency:    ${concurrency}`);
console.log(`Total evals:    ${workItems.length}\n`);

const results: ConditionResult[] = [];

const worker = async (item: WorkItem): Promise<ConditionResult> => {
  const tag = `[${item.condition.name} run=${item.run}]`;
  console.log(`${elapsed()} ${tag} starting...`);
  const result = await runCondition(item.condition, item.run);
  console.log(
    `${elapsed()} ${tag} score=${result.score.toFixed(2)} found=${result.found} fp=${result.falsePositives} (review=${(result.reviewLatencyMs / 1000).toFixed(1)}s judge=${(result.judgeLatencyMs / 1000).toFixed(1)}s)`,
  );
  return result;
};

const q = fastq.promise(worker, concurrency);
const settled = await Promise.all(workItems.map((item) => q.push(item)));
results.push(...settled);

// ── Report ───────────────────────────────────────────────────────────────────

const avg = (arr: number[]) =>
  arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
const fmtDelta = (d: number) => `${d >= 0 ? '+' : ''}${d.toFixed(2)}`;

console.log(
  `\n${elapsed()} ═══════════════════════════════════════════════════`,
);
console.log('  RESULTS');
console.log('═══════════════════════════════════════════════════\n');

const controlResults = results.filter((r) => r.condition === 'control');
const controlAvg = avg(controlResults.map((r) => r.score));

console.log(
  `  ${'Condition'.padEnd(25)} ${'Score'.padEnd(10)} ${'Found'.padEnd(10)} ${'FP'.padEnd(10)} ${'Latency'.padEnd(10)} Delta`,
);
console.log('  ' + '─'.repeat(75));

for (const condition of conditions) {
  const cResults = results.filter((r) => r.condition === condition.name);
  const scoreAvg = avg(cResults.map((r) => r.score));
  const foundAvg = avg(cResults.map((r) => r.found));
  const fpAvg = avg(cResults.map((r) => r.falsePositives));
  const latAvg = avg(cResults.map((r) => r.reviewLatencyMs)) / 1000;
  const delta =
    condition.name === 'control' ? '' : fmtDelta(scoreAvg - controlAvg);

  console.log(
    `  ${condition.name.padEnd(25)} ${scoreAvg.toFixed(2).padEnd(10)} ${foundAvg.toFixed(1).padEnd(10)} ${fpAvg.toFixed(1).padEnd(10)} ${latAvg.toFixed(1).padEnd(10)}s ${delta}`,
  );
}

// Per-run breakdown
if (runs > 1) {
  console.log('\nPer-run breakdown:');
  for (let run = 1; run <= runs; run++) {
    const parts = conditions.map((c) => {
      const r = results.find(
        (res) => res.condition === c.name && res.run === run,
      );
      return r
        ? `${c.name}=${r.score.toFixed(2)}(f=${r.found},fp=${r.falsePositives})`
        : `${c.name}=?`;
    });
    console.log(`  Run ${run}: ${parts.join(' | ')}`);
  }
}

// Judge reasoning (last run)
console.log('\nJudge reasoning (last run):');
for (const condition of conditions) {
  const last = results.filter((r) => r.condition === condition.name).pop();
  if (last) {
    console.log(`  ${condition.name}: ${last.reasoning}`);
  }
}

console.log(`\n  Total time: ${elapsed()}`);
console.log('═══════════════════════════════════════════════════');

// ── Save ─────────────────────────────────────────────────────────────────────

const outDirArg = values['out-dir'];
const outDir =
  typeof outDirArg === 'string'
    ? resolve(outDirArg)
    : resolve(import.meta.dirname, 'results');
await mkdir(outDir, { recursive: true });
const outPath = resolve(outDir, `mirror-${model}-${Date.now()}.json`);

const summary: Record<string, { avg: number; found: number; fp: number }> = {};
for (const condition of conditions) {
  const cResults = results.filter((r) => r.condition === condition.name);
  summary[condition.name] = {
    avg: avg(cResults.map((r) => r.score)),
    found: avg(cResults.map((r) => r.found)),
    fp: avg(cResults.map((r) => r.falsePositives)),
  };
}

await writeFile(
  outPath,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      model,
      judgeModel,
      runs,
      concurrency,
      conditions: conditions.map((c) => ({
        name: c.name,
        instructionLength: c.instruction.length,
      })),
      results,
      summary,
    },
    null,
    2,
  ),
  'utf8',
);
console.log(`\nReport saved to ${outPath}`);
