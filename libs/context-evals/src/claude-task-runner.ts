import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { createClaudeQuery } from './anthropic.js';
import type { AssistantPayload, ResultPayload } from './sdk-types.js';

interface RunnerArgs {
  cwd: string;
  prompt?: string;
  promptFile?: string;
  model?: string;
  maxTurns: number;
  clientApp: string;
}

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

function parseArgs(argv: string[]): RunnerArgs {
  const args: Partial<RunnerArgs> = {
    maxTurns: 20,
    clientApp: '@moltnet/tools:gpack',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--cwd') {
      args.cwd = resolve(process.cwd(), argv[++i] ?? '');
      continue;
    }
    if (arg === '--prompt') {
      args.prompt = argv[++i] ?? '';
      continue;
    }
    if (arg === '--prompt-file') {
      args.promptFile = resolve(process.cwd(), argv[++i] ?? '');
      continue;
    }
    if (arg === '--model') {
      args.model = argv[++i] ?? '';
      continue;
    }
    if (arg === '--max-turns') {
      const raw = argv[++i] ?? '';
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`Invalid --max-turns value: ${raw}`);
      }
      args.maxTurns = parsed;
      continue;
    }
    if (arg === '--client-app') {
      args.clientApp = argv[++i] ?? args.clientApp;
      continue;
    }
  }

  if (!args.cwd) {
    throw new Error('Missing required --cwd');
  }

  return args as RunnerArgs;
}

async function resolvePrompt(args: RunnerArgs): Promise<string> {
  if (args.promptFile) {
    return readFile(args.promptFile, 'utf8');
  }
  if (args.prompt) {
    return args.prompt;
  }
  throw new Error('Missing prompt: use --prompt or --prompt-file');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const prompt = await resolvePrompt(args);

  let stderrOutput = '';
  let sessionId: string | undefined;
  let finalResult: ResultPayload | null = null;
  let lastAssistantText = '';
  let toolCallCount = 0;
  const toolSummaries: string[] = [];

  const q = await createClaudeQuery({
    cwd: args.cwd,
    prompt,
    model: args.model,
    maxTurns: args.maxTurns,
    clientApp: args.clientApp,
    stderr: (data: string) => {
      stderrOutput += data;
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
