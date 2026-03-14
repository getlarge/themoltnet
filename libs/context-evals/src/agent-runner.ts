/**
 * agent-runner.ts — Shared Claude Agent SDK message consumption
 *
 * Provides a single `runAgentTask()` function that creates a Claude query,
 * iterates over SDKMessage events, and returns a structured result.
 * Used by both the gpack evaluator (evaluate.ts) and the skill-eval adapter
 * (skill-adapter.ts) to avoid duplicated message-loop logic.
 */

import type {
  SDKMessage,
  SDKRateLimitEvent,
} from '@anthropic-ai/claude-agent-sdk';

import { type ClaudeQueryOptions, createClaudeQuery } from './anthropic.js';
import type {
  AssistantContentBlock,
  AssistantPayload,
  ResultPayload,
} from './sdk-types.js';

// ── Result type ──────────────────────────────────────────────────────────────

export interface AgentRunResult {
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
  toolCallCount: number;
  toolSummaries: string[];
  permissionDenials?: Array<{ toolName: string; toolUseId: string }>;
  rateLimitRejected?: boolean;
}

// ── Runner ───────────────────────────────────────────────────────────────────

export async function runAgentTask(
  options: ClaudeQueryOptions,
): Promise<AgentRunResult> {
  let stderrOutput = '';
  let sessionId: string | undefined;
  let finalResult: ResultPayload | null = null;
  let lastAssistantText = '';
  let toolCallCount = 0;
  const toolSummaries: string[] = [];

  const originalStderr = options.stderr;
  const q = await createClaudeQuery({
    ...options,
    stderr: (data: string) => {
      if (stderrOutput.length < 512_000) {
        stderrOutput += data;
      }
      originalStderr?.(data);
    },
  });

  try {
    for await (const message of q as AsyncIterable<SDKMessage>) {
      sessionId ??= message.session_id;

      switch (message.type) {
        case 'assistant': {
          const payload = message as unknown as AssistantPayload;
          const textBlocks = payload.message.content.filter(
            (b): b is AssistantContentBlock & { text: string } =>
              b.type === 'text' && typeof b.text === 'string',
          );
          if (textBlocks.length > 0) {
            lastAssistantText = textBlocks.map((b) => b.text).join('\n');
          }
          toolCallCount += payload.message.content.filter(
            (b) => b.type === 'tool_use',
          ).length;
          break;
        }
        case 'tool_use_summary': {
          toolSummaries.push(
            (message as unknown as { summary: string }).summary,
          );
          break;
        }
        case 'result': {
          finalResult = message as unknown as ResultPayload;
          break;
        }
        case 'rate_limit_event': {
          const rateLimit = message as unknown as SDKRateLimitEvent;
          if (rateLimit.rate_limit_info.status === 'rejected') {
            q.close();
            return {
              passed: false,
              output: `Rate limited (type=${rateLimit.rate_limit_info.rateLimitType ?? 'unknown'}, resets=${rateLimit.rate_limit_info.resetsAt ?? 'unknown'})`,
              stderrOutput: stderrOutput || undefined,
              sessionId,
              toolCallCount,
              toolSummaries,
              rateLimitRejected: true,
            };
          }
          break;
        }
      }
    }
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : 'Agent SDK execution failed';
    q.close();
    return {
      passed: false,
      output: stderrOutput ? `${msg}\n\n${stderrOutput.trim()}` : msg,
      stderrOutput: stderrOutput || undefined,
      sessionId,
      toolCallCount,
      toolSummaries,
    };
  }

  q.close();

  if (!finalResult) {
    return {
      passed: false,
      output: stderrOutput
        ? `${lastAssistantText || 'No result from Agent SDK'}\n\n${stderrOutput.trim()}`
        : lastAssistantText || 'No result from Agent SDK',
      stderrOutput: stderrOutput || undefined,
      sessionId,
      toolCallCount,
      toolSummaries,
    };
  }

  return {
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
    permissionDenials: (finalResult.permission_denials ?? []).map((d) => ({
      toolName: d.tool_name,
      toolUseId: d.tool_use_id,
    })),
  };
}
