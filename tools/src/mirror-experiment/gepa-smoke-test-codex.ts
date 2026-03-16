#!/usr/bin/env -S npx tsx
/* eslint-disable no-console */

import { ax, AxGEPA } from '@ax-llm/ax';
import { AxAICodexAgentSDK } from '@moltnet/context-evals/pipeline-shared';

const t0 = performance.now();
const elapsed = () => `[${((performance.now() - t0) / 1000).toFixed(1)}s]`;

const classifier = ax(
  'emailText:string "Email content" -> priority:class "high, normal, low"',
);

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
    `${elapsed()} [metric ${metricCalls}] expected=${String(ex?.priority)} predicted=${String(pred?.priority)} correct=${correct}`,
  );

  return { accuracy: correct } as unknown as number;
};

const model = process.env.GPACK_AGENT_MODEL || 'gpt-5-codex-mini';

const studentAI = new AxAICodexAgentSDK({ model, maxTurns: 1 });
const teacherAI = new AxAICodexAgentSDK({ model, maxTurns: 1 });

const optimizer = new AxGEPA({
  studentAI,
  teacherAI,
  numTrials: 2,
  verbose: true,
  seed: 42,
});

console.log('╔═══════════════════════════════════════════════════╗');
console.log('║          GEPA SMOKE TEST (Codex SDK)             ║');
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

console.log(`\n${elapsed()} Running inference with optimized program...\n`);

const testAI = new AxAICodexAgentSDK({ model, maxTurns: 1 });
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
