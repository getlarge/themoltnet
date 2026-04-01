/* eslint-disable no-console */
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { Codex } from '@openai/codex-sdk';

/**
 * @typedef {{ name: string; description: string; max_score: number }} Criterion
 * @typedef {{ type: string; context: string; checklist: Criterion[] }} Criteria
 * @typedef {{ name: string; score: number; max_score: number; evidence: string }} ScoredCriterion
 */

/**
 * @param {Record<string, number>} reward
 */
async function writeReward(reward) {
  await mkdir('/logs/verifier', { recursive: true });
  await writeFile(
    '/logs/verifier/reward.json',
    JSON.stringify(reward, null, 2),
  );
}

try {
  /** @type {Criteria} */
  const criteria = JSON.parse(
    await readFile('/tests/criteria.json', 'utf-8'),
  );

  const checklist = Array.isArray(criteria.checklist)
    ? criteria.checklist
    : [];
  const context =
    typeof criteria.context === 'string' ? criteria.context : '';

  const prompt = `You are an eval judge. Read all files the agent produced in /app.

Score the agent's work against this weighted checklist. For EACH criterion,
determine a score from 0 to max_score.

Criteria:
${checklist.map((c, i) => `${i + 1}. "${c.name}" (max ${c.max_score}): ${c.description}`).join('\n')}

Context: ${context}

Return your scores as a JSON array — one object per criterion:
[
  { "name": "criterion name", "score": <number>, "max_score": <number>, "evidence": "one sentence" },
  ...
]`;

  const model = process.env.JUDGE_MODEL ?? 'gpt-5-codex';
  const codex = new Codex({
    ...(process.env.OPENAI_API_KEY
      ? { apiKey: process.env.OPENAI_API_KEY }
      : {}),
  });
  const thread = codex.startThread({
    model,
    sandboxMode: 'read-only',
    skipGitRepoCheck: true,
    approvalPolicy: 'never',
    cwd: '/app',
  });

  const turn = await thread.run(prompt, {
    outputSchema: {
      type: 'object',
      properties: {
        scores: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              score: { type: 'number' },
              max_score: { type: 'number' },
              evidence: { type: 'string' },
            },
            required: ['name', 'score', 'max_score', 'evidence'],
          },
        },
      },
      required: ['scores'],
    },
  });

  /** @type {ScoredCriterion[]} */
  let scored;
  const responseText = turn.finalResponse || '';

  try {
    const parsed = JSON.parse(responseText);
    scored = Array.isArray(parsed) ? parsed : parsed.scores;
  } catch {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('Judge did not produce valid JSON. Raw output:');
      console.error(responseText);
      await writeReward({ reward: 0 });
      process.exit(1);
    }
    scored = JSON.parse(jsonMatch[0]);
  }

  const totalScore = scored.reduce((sum, c) => sum + c.score, 0);
  const maxTotal = scored.reduce((sum, c) => sum + c.max_score, 0);
  const normalizedReward = maxTotal > 0 ? totalScore / maxTotal : 0;

  /** @type {Record<string, number>} */
  const details = {};
  for (const c of scored) {
    const key = c.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    details[key] = c.max_score > 0 ? c.score / c.max_score : 0;
  }

  console.log('Scores:');
  for (const c of scored) {
    console.log(`  ${c.score}/${c.max_score} ${c.name}: ${c.evidence}`);
  }
  console.log(
    `\nTotal: ${totalScore}/${maxTotal} (${(normalizedReward * 100).toFixed(1)}%)`,
  );

  await writeReward({ reward: normalizedReward });
  await writeFile(
    '/logs/verifier/scores.json',
    JSON.stringify(details, null, 2),
  );
} catch (err) {
  console.error('Judge failed:', err);
  await writeReward({ reward: 0 });
  process.exit(1);
}
