import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import type { Criteria } from './scenarios.ts';

const ScoresSchema = z.object({
  scores: z.array(
    z.object({
      name: z.string(),
      score: z.number(),
      max_score: z.number(),
      evidence: z.string(),
    }),
  ),
  reasoning: z.string(),
});

export type JudgeResult = {
  scores: Array<{
    name: string;
    score: number;
    max_score: number;
    evidence: string;
  }>;
  reasoning: string;
  total: number;
  maxTotal: number;
  pct: number;
};

const JUDGE_INSTRUCTION = `You are an eval judge. Score the agent output against the weighted checklist criteria.

Return one entry per criterion with:
- score: number between 0 and max_score inclusive
- evidence: one sentence citing specific content from the workspace files

Rules:
- Every criterion must appear (same name, exact match).
- If the workspace is empty or unhelpful, score all criteria 0 with evidence "no evidence found".
- Use the scenario context (if provided) to understand what the task is really testing.`;

async function readWorkspace(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const parts: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isFile()) continue;
    const full = path.join(dir, e.name);
    const s = await stat(full);
    if (s.size > 100_000) {
      parts.push(`### ${e.name}\n[skipped: ${s.size} bytes]\n`);
      continue;
    }
    const content = await readFile(full, 'utf8');
    parts.push(`### ${e.name}\n\`\`\`\n${content}\n\`\`\`\n`);
  }
  return parts.length
    ? parts.join('\n')
    : '(empty workspace — agent produced no files)';
}

export async function judge(opts: {
  criteria: Criteria;
  workspaceDir: string;
  model: string;
}): Promise<JudgeResult> {
  const client = new Anthropic();
  const workspace = await readWorkspace(opts.workspaceDir);
  const criteriaJson = JSON.stringify(opts.criteria, null, 2);

  const userMessage = `${JUDGE_INSTRUCTION}

--- Criteria ---
${criteriaJson}

--- Agent workspace ---
${workspace}`;

  const response = await client.messages.parse({
    model: opts.model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: userMessage }],
    output_config: { format: zodOutputFormat(ScoresSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error(
      'judge: parsed_output is null (schema mismatch or refusal)',
    );
  }

  const nameToMax = new Map(
    opts.criteria.checklist.map((c) => [c.name, c.max_score]),
  );
  const total = parsed.scores.reduce(
    (sum, s) => sum + Math.max(0, Math.min(s.score, s.max_score)),
    0,
  );
  const maxTotal = [...nameToMax.values()].reduce((a, b) => a + b, 0);
  const pct = maxTotal === 0 ? 0 : (total / maxTotal) * 100;

  return { ...parsed, total, maxTotal, pct };
}
