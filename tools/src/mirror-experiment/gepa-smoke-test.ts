#!/usr/bin/env -S npx tsx
/* eslint-disable no-console */
/**
 * gepa-smoke-test — Minimal GEPA example with AxAIClaudeAgentSDK
 *
 * Reproduces the ax-llm email classifier GEPA example using our
 * Agent SDK adapter instead of a direct API key. Proves GEPA works
 * end-to-end with AxAIClaudeAgentSDK before we try mirror optimization.
 *
 * Usage:
 *   pnpm gepa-smoke-test
 */

import { ax, AxGEPA } from '@ax-llm/ax';
import { AxAIClaudeAgentSDK } from '@moltnet/ax-agents';

// ── Timing ──────────────────────────────────────────────────────────────────

const t0 = performance.now();
const elapsed = () => `[${((performance.now() - t0) / 1000).toFixed(1)}s]`;

// ── Program: email classifier (from ax-llm examples) ─────────────────────────

const classifier = ax(
  'emailText:string "Email content" -> priority:class "high, normal, low"',
);

// ── Training data (with expected outputs) ────────────────────────────────────

const train = [
  {
    emailText: 'URGENT: Server is down, all services affected!',
    priority: 'high',
  },
  { emailText: 'Reminder: team standup at 10am tomorrow', priority: 'normal' },
  { emailText: 'Weekly newsletter: top articles this week', priority: 'low' },
  {
    emailText: 'CRITICAL: Security breach detected in production',
    priority: 'high',
  },
  { emailText: 'Thanks for your help with the docs update', priority: 'low' },
];

const val = [
  {
    emailText: 'ACTION REQUIRED: Password expires in 24 hours',
    priority: 'high',
  },
  { emailText: 'FYI: New coffee machine in the kitchen', priority: 'low' },
];

// ── Metric: exact match ──────────────────────────────────────────────────────

let metricCalls = 0;

const metric = async ({
  prediction,
  example,
}: Readonly<{
  prediction: unknown;
  example: unknown;
}>) => {
  metricCalls++;
  const pred = prediction as Record<string, unknown>;
  const ex = example as Record<string, unknown>;
  const correct = pred?.priority === ex?.priority ? 1 : 0;

  console.log(
    `${elapsed()} [metric ${metricCalls}] expected=${String(ex?.priority)} predicted=${String(pred?.priority)} correct=${correct} type=${typeof correct}`,
  );

  // GEPA's normalizeScores expects Record<string, number> at runtime, but
  // AxMetricFn types say number. Cast through unknown to satisfy both.
  // DO NOT simplify to `return correct` — bare numbers produce bestScore: 0.
  return { accuracy: correct } as unknown as number;
};

// ── GEPA setup ───────────────────────────────────────────────────────────────

const model = 'claude-haiku-4-5';

const studentAI = new AxAIClaudeAgentSDK({ model, maxTurns: 1 });
const teacherAI = new AxAIClaudeAgentSDK({ model, maxTurns: 1 });

const optimizer = new AxGEPA({
  studentAI,
  teacherAI,
  numTrials: 2,
  verbose: true,
  seed: 42,
});

// ── Run ──────────────────────────────────────────────────────────────────────

console.log('╔═══════════════════════════════════════════════════╗');
console.log('║          GEPA SMOKE TEST (Agent SDK)             ║');
console.log('╚═══════════════════════════════════════════════════╝');
console.log(`Model: ${model}`);
console.log(`Train: ${train.length} examples`);
console.log(`Val:   ${val.length} examples`);
console.log(`Trials: 2\n`);

console.log(`${elapsed()} Starting compile...\n`);

const result = await optimizer.compile(
  classifier,
  train,
  metric as Parameters<typeof optimizer.compile>[2],
  {
    maxMetricCalls: 30,
    validationExamples: val,
  },
);

console.log(
  `\n${elapsed()} ═══════════════════════════════════════════════════`,
);
console.log('  RESULTS');
console.log('═══════════════════════════════════════════════════');
console.log(`  Best score:    ${result.bestScore.toFixed(3)}`);
console.log(`  Metric calls:  ${metricCalls}`);
console.log(
  `  Total time:    ${((performance.now() - t0) / 1000).toFixed(1)}s`,
);

const optimizedInstruction = result.optimizedProgram?.instruction;
if (optimizedInstruction) {
  console.log(`  Instruction (${optimizedInstruction.length} chars):`);
  console.log(`    ${optimizedInstruction.slice(0, 200).replace(/\n/g, ' ')}`);
}
console.log('═══════════════════════════════════════════════════');

// Quick inference test
console.log(`\n${elapsed()} Running inference with optimized program...\n`);

const testAI = new AxAIClaudeAgentSDK({ model, maxTurns: 1 });
const tests = [
  'EMERGENCY: Database corruption, data loss imminent',
  'Hey, lunch at noon?',
  'Monthly expense report attached',
];

for (const emailText of tests) {
  const pred = await classifier.forward(testAI, { emailText });
  console.log(`${elapsed()}   "${emailText.slice(0, 50)}" → ${pred.priority}`);
}

console.log(`\n${elapsed()} Done.`);
