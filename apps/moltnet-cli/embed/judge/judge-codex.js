/* eslint-disable no-console */
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { Codex } from '@openai/codex-sdk';

import { withRetry } from './retry.js';

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

/**
 * Returns true for transient network errors worth retrying.
 * Returns false for 401 auth errors and bad-output errors.
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryableError(err) {
  const msg = (err.message ?? String(err)).toLowerCase();
  // Never retry auth failures — they need a credentials fix, not a retry
  if (
    msg.includes('401') ||
    msg.includes('unauthorized') ||
    msg.includes('incorrect api key')
  ) {
    return false;
  }
  return (
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('connect error') ||
    msg.includes('network')
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

  /** @type {ScoredCriterion[]} */
  const scored = await withRetry(
    async () => {
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

      const responseText = turn.finalResponse || '';
      let result;
      try {
        const parsed = JSON.parse(responseText);
        result = Array.isArray(parsed) ? parsed : parsed.scores;
      } catch {
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          const err = new Error(
            `Judge did not produce valid JSON. Raw output:\n${responseText}`,
          );
          err.nonRetryable = true;
          throw err;
        }
        result = JSON.parse(jsonMatch[0]);
      }
      return result;
    },
    {
      shouldRetry: (err) => {
        if (err.nonRetryable) return false;
        return isRetryableError(err);
      },
    },
  );

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
