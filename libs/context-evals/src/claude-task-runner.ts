import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { createClaudeQuery } from './anthropic.js';
import type { AssistantPayload, ResultPayload } from './sdk-types.js';

interface RunnerResult {
  passed: boolean;
  output: string;
  stderrOutput?: string;
  sessionId?: string;
  turnCount?: number;
  durationMs?: number;
  apiDurationMs?: number;
  costUsd?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  toolCallCount?: number;
  toolSummaries?: string[];
  permissionDenials?: Array<{ toolName: string; toolUseId: string }>;
}

const { values } = parseArgs({
  options: {
    cwd: { type: 'string' },
    prompt: { type: 'string' },
    'prompt-file': { type: 'string' },
    model: { type: 'string' },
    'max-turns': { type: 'string', default: '20' },
    'client-app': { type: 'string', default: '@moltnet/tools:gpack' },
  },
  strict: true,
});

async function main(): Promise<void> {
  if (!values.cwd) {
    throw new Error('Missing required --cwd');
  }
  const cwd = resolve(process.cwd(), values.cwd);

  const maxTurns = Number(values['max-turns']);
  if (!Number.isFinite(maxTurns) || maxTurns < 1) {
    throw new Error(`Invalid --max-turns value: ${values['max-turns']}`);
  }

  const clientApp = values['client-app'] ?? '@moltnet/tools:gpack';

  let prompt: string;
  if (values['prompt-file']) {
    prompt = await readFile(
      resolve(process.cwd(), values['prompt-file']),
      'utf8',
    );
  } else if (values.prompt) {
    prompt = values.prompt;
  } else {
    throw new Error('Missing prompt: use --prompt or --prompt-file');
  }

  let stderrOutput = '';
  let sessionId: string | undefined;
  let finalResult: ResultPayload | null = null;
  let lastAssistantText = '';
  let toolCallCount = 0;
  const toolSummaries: string[] = [];

  const q = await createClaudeQuery({
    cwd,
    prompt,
    model: values.model,
    maxTurns,
    clientApp,
    stderr: (data: string) => {
      if (stderrOutput.length < 512_000) {
        stderrOutput += data;
      }
    },
  });

  try {
    for await (const message of q as AsyncIterable<SDKMessage>) {
      sessionId ??= message.session_id;

      if (message.type === 'assistant') {
        const assistantMessage = message as unknown as AssistantPayload;
        const textBlocks = assistantMessage.message.content.filter(
          (b): b is { type: 'text'; text: string } =>
            b.type === 'text' && typeof b.text === 'string',
        );
        if (textBlocks.length > 0) {
          lastAssistantText = textBlocks.map((b) => b.text).join('\n');
        }
        toolCallCount += assistantMessage.message.content.filter(
          (block) => block.type === 'tool_use',
        ).length;
      } else if (message.type === 'tool_use_summary') {
        toolSummaries.push(message.summary);
      } else if (message.type === 'result') {
        finalResult = message as unknown as ResultPayload;
      }
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Anthropic SDK execution failed';
    const result: RunnerResult = {
      passed: false,
      output: stderrOutput ? `${message}\n\n${stderrOutput.trim()}` : message,
      stderrOutput: stderrOutput || undefined,
      sessionId,
      toolCallCount,
      toolSummaries,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    q.close();
    return;
  }

  q.close();

  if (!finalResult) {
    const result: RunnerResult = {
      passed: false,
      output: stderrOutput
        ? `${lastAssistantText || 'No result message received from Anthropic SDK'}\n\n${stderrOutput.trim()}`
        : lastAssistantText || 'No result message received from Anthropic SDK',
      stderrOutput: stderrOutput || undefined,
      sessionId,
      toolCallCount,
      toolSummaries,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  const result: RunnerResult = {
    passed: finalResult.subtype === 'success' && !finalResult.is_error,
    output:
      finalResult.subtype === 'success'
        ? (finalResult.result ?? lastAssistantText)
        : finalResult.errors?.join('\n') || lastAssistantText,
    stderrOutput: stderrOutput || undefined,
    sessionId,
    turnCount: finalResult.num_turns,
    durationMs: finalResult.duration_ms,
    apiDurationMs: finalResult.duration_api_ms,
    costUsd: finalResult.total_cost_usd,
    usage: {
      inputTokens: finalResult.usage?.input_tokens ?? 0,
      outputTokens: finalResult.usage?.output_tokens ?? 0,
      cacheCreationInputTokens: finalResult.usage?.cache_creation_input_tokens,
      cacheReadInputTokens: finalResult.usage?.cache_read_input_tokens,
    },
    toolCallCount,
    toolSummaries,
    permissionDenials: (finalResult.permission_denials ?? []).map((denial) => ({
      toolName: denial.tool_name,
      toolUseId: denial.tool_use_id,
    })),
  };

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

void main();
