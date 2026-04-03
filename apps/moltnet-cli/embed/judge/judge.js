/* eslint-disable no-console */
// TODO: consider migrating to https://github.com/anthropics/claude-agent-sdk-python
//       once it reaches feature parity with the JS SDK (as of 2026-04 it is early-stage).
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { withRetry } from './retry.js';

/**
 * @typedef {{ name: string; description: string; max_score: number }} Criterion
 * @typedef {{ type: string; context: string; checklist: Criterion[] }} Criteria
 * @typedef {{ name: string; score: number; max_score: number; evidence: string }} ScoredCriterion
 */

/**
 * Build a clean env for the Claude Code subprocess spawned by the SDK.
 *
 * Only strips CLAUDECODE (nested-session guard). Keeps CLAUDE_CODE_OAUTH_TOKEN
 * because inside the Harbor Docker container it's the primary auth credential
 * (via docker/sandbox-templates:claude-code with apiKeyHelper stripped).
 * @returns {Record<string, string | undefined>}
 */
function getRuntimeEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
}

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
 * Returns true for transient network/process errors worth retrying.
 * Returns false for auth failures and bad-output errors.
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryableError(err) {
  const msg = (err.message ?? String(err)).toLowerCase();
  // Claude Code process exited — only retry if it looks like a connection issue
  if (msg.includes('process exited') || msg.includes('exit code')) {
    return (
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('unknown')
    );
  }
  return (
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('connect error')
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

After reading the files, output ONLY a JSON array — one object per criterion:
[
  { "name": "criterion name", "score": <number>, "max_score": <number>, "evidence": "one sentence" },
  ...
]

No markdown fences. No explanation outside the JSON.`;

  const runtimeEnv = getRuntimeEnv();
  const claudePath =
    process.env.CLAUDE_CODE_EXECUTABLE || '/home/agent/.local/bin/claude';

  /** @type {ScoredCriterion[]} */
  const scored = await withRetry(
    async () => {
      const conversation = query({
        prompt,
        options: {
          cwd: '/app',
          pathToClaudeCodeExecutable: claudePath,
          model: process.env.JUDGE_MODEL ?? 'claude-sonnet-4-6',
          permissionMode: 'bypassPermissions',
          tools: { type: 'preset', preset: 'claude_code' },
          persistSession: false,
          includePartialMessages: false,
          maxTurns: 5,
          settings: { disableAllHooks: true },
          debug: process.env.MOLTNET_EVAL_DEBUG === '1',
          env: {
            ...runtimeEnv,
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
            ENABLE_TOOL_SEARCH: '0',
          },
        },
      });

      let lastText = '';
      for await (const message of conversation) {
        if (message.type === 'assistant') {
          const texts = message.message.content
            .filter((b) => b.type === 'text' && typeof b.text === 'string')
            .map((b) => b.text);
          if (texts.length > 0) lastText = texts.join('\n');
        }
      }

      const jsonMatch = lastText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        // Bad output is not a network error — mark non-retryable
        const err = new Error(
          `Judge did not produce valid JSON array. Raw output:\n${lastText}`,
        );
        err.nonRetryable = true;
        throw err;
      }

      return JSON.parse(jsonMatch[0]);
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

  // Harbor's mean metric expects exactly one key in reward.json
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
