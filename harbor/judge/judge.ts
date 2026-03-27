import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { query } from '@anthropic-ai/claude-agent-sdk';

interface Criterion {
  name: string;
  description: string;
  max_score: number;
}

interface Criteria {
  type: string;
  context: string;
  checklist: Criterion[];
}

interface ScoredCriterion {
  name: string;
  score: number;
  max_score: number;
  evidence: string;
}

async function main(): Promise<void> {
  const criteriaRaw = await readFile('/tests/criteria.json', 'utf-8');
  const criteria: Criteria = JSON.parse(criteriaRaw);

  const prompt = `You are an eval judge. Read all files the agent produced in /app.

Score the agent's work against this weighted checklist. For EACH criterion,
determine a score from 0 to max_score.

Criteria:
${criteria.checklist.map((c, i) => `${i + 1}. "${c.name}" (max ${c.max_score}): ${c.description}`).join('\n')}

Context: ${criteria.context}

After reading the files, output ONLY a JSON array — one object per criterion:
[
  { "name": "criterion name", "score": <number>, "max_score": <number>, "evidence": "one sentence" },
  ...
]

No markdown fences. No explanation outside the JSON.`;

  const conversation = query({
    prompt,
    options: {
      cwd: '/app',
      model: process.env.JUDGE_MODEL ?? 'claude-sonnet-4-6',
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      tools: { type: 'preset', preset: 'claude_code' },
      persistSession: false,
      maxTurns: 5,
      settings: { disableAllHooks: true },
      env: {
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        ...(process.env.ANTHROPIC_API_KEY
          ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
          : {}),
        ...(process.env.CLAUDE_CODE_OAUTH_TOKEN
          ? { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN }
          : {}),
      },
    },
  });

  let lastText = '';
  for await (const message of conversation) {
    if (message.type === 'assistant') {
      const payload = message as unknown as {
        message: { content: Array<{ type: string; text?: string }> };
      };
      const texts = payload.message.content
        .filter(
          (b): b is { type: 'text'; text: string } =>
            b.type === 'text' && typeof b.text === 'string',
        )
        .map((b) => b.text);
      if (texts.length > 0) lastText = texts.join('\n');
    }
  }

  const jsonMatch = lastText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('Judge did not produce valid JSON array. Raw output:');
    console.error(lastText);
    await writeReward({ reward: 0 });
    process.exit(1);
  }

  const scored: ScoredCriterion[] = JSON.parse(jsonMatch[0]);
  const totalScore = scored.reduce((sum, c) => sum + c.score, 0);
  const maxTotal = scored.reduce((sum, c) => sum + c.max_score, 0);
  const normalizedReward = maxTotal > 0 ? totalScore / maxTotal : 0;

  const reward: Record<string, number> = { reward: normalizedReward };
  for (const c of scored) {
    const key = c.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    reward[key] = c.max_score > 0 ? c.score / c.max_score : 0;
  }

  console.log('Scores:');
  for (const c of scored) {
    console.log(`  ${c.score}/${c.max_score} ${c.name}: ${c.evidence}`);
  }
  console.log(
    `\nTotal: ${totalScore}/${maxTotal} (${(normalizedReward * 100).toFixed(1)}%)`,
  );

  await writeReward(reward);
}

async function writeReward(reward: Record<string, number>): Promise<void> {
  await mkdir('/logs/verifier', { recursive: true });
  await writeFile(
    '/logs/verifier/reward.json',
    JSON.stringify(reward, null, 2),
  );
}

main().catch((err) => {
  console.error('Judge failed:', err);
  writeReward({ reward: 0 }).then(() => process.exit(1));
});
