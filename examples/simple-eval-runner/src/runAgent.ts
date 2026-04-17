import { mkdir } from 'node:fs/promises';

import { query } from '@anthropic-ai/claude-agent-sdk';

export type AgentRunResult = {
  sandboxDir: string;
  numTurns: number;
  costUsd: number;
  durationMs: number;
  ok: boolean;
  errorDetails?: string[];
};

const SYSTEM_PROMPT = `You are an engineer completing a short coding task inside an empty sandbox directory.

Read the task carefully. Produce EXACTLY the files the task asks for, in the sandbox directory. Do not create unrelated files. Do not invoke external tools or the network. When you believe you are done, stop.`;

export async function runAgent(opts: {
  sandboxDir: string;
  task: string;
  extraContext?: string;
  model: string;
  maxTurns?: number;
}): Promise<AgentRunResult> {
  await mkdir(opts.sandboxDir, { recursive: true });

  const systemPrompt = opts.extraContext
    ? `${SYSTEM_PROMPT}\n\n--- Team knowledge pack (retrieved from MoltNet) ---\n${opts.extraContext}\n--- End of pack ---`
    : SYSTEM_PROMPT;

  const started = Date.now();
  const q = query({
    prompt: opts.task,
    options: {
      systemPrompt,
      model: opts.model,
      cwd: opts.sandboxDir,
      settingSources: [],
      permissionMode: 'bypassPermissions',
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
      maxTurns: opts.maxTurns ?? 15,
    },
  });

  for await (const msg of q) {
    if (msg.type !== 'result') continue;
    const base = {
      sandboxDir: opts.sandboxDir,
      numTurns: msg.num_turns,
      costUsd: msg.total_cost_usd,
      durationMs: Date.now() - started,
    };
    if (msg.subtype === 'success') {
      return { ...base, ok: true };
    }
    return { ...base, ok: false, errorDetails: msg.errors };
  }
  throw new Error('agent query ended without a result message');
}
