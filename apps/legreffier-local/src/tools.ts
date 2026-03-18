/**
 * Legreffier Local MCP — Tool handlers + registration
 */

import type { CallToolResult } from '@getlarge/fastify-mcp';
import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { queryDiary } from './rag.js';
import type { LocalMcpDeps } from './types.js';
import { truncate } from './util.js';

// Re-export for tests
export type { CallToolResult };

// ── Schemas ───────────────────────────────────────────

export const AskSchema = Type.Object({
  question: Type.String({ description: 'Question about the codebase.' }),
  codeContext: Type.Optional(
    Type.String({
      description: 'Relevant code snippet or file content for context.',
    }),
  ),
});

export const FeedbackSchema = Type.Object({
  traceIndex: Type.Optional(
    Type.Integer({
      description: 'Trace index from this session (default: latest).',
    }),
  ),
  score: Type.Number({
    description: 'Quality score: 0 = bad, 1 = good.',
    minimum: 0,
    maximum: 1,
  }),
  label: Type.Optional(
    Type.String({ description: 'Short label (e.g. "wrong-scope").' }),
  ),
  comment: Type.Optional(Type.String({ description: 'Detailed feedback.' })),
});

export const TracesSchema = Type.Object({
  limit: Type.Optional(
    Type.Integer({
      description: 'Max traces to return (default: 5).',
      minimum: 1,
      maximum: 50,
    }),
  ),
});

export const OptimizeSchema = Type.Object({
  budget: Type.Optional(
    Type.Integer({
      description: 'Max optimization rounds (default: 5).',
      minimum: 1,
      maximum: 20,
    }),
  ),
});

export const StatusSchema = Type.Object({});

type AskInput = Static<typeof AskSchema>;
type FeedbackInput = Static<typeof FeedbackSchema>;
type TracesInput = Static<typeof TracesSchema>;
type OptimizeInput = Static<typeof OptimizeSchema>;

// ── Result helpers ────────────────────────────────────

function textResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// ── Handlers ──────────────────────────────────────────

export async function handleAsk(
  args: AskInput,
  deps: LocalMcpDeps,
): Promise<CallToolResult> {
  deps.lastActivity = Date.now();
  // Reserve index synchronously to avoid races with concurrent calls
  const thisIndex = ++deps.traceCounter;

  try {
    // Auto-enrich: diary search + LLM reranking
    let diaryContext = '';
    try {
      const ragResult = await queryDiary(args.question, {
        sdkAgent: deps.sdkAgent,
        diaryId: deps.diaryId,
      });
      if (ragResult.context) {
        diaryContext = ragResult.context;
        deps.logger.info(
          { results: ragResult.resultCount },
          'Diary context retrieved',
        );
      }
    } catch (ragErr) {
      deps.logger.warn(
        { err: ragErr },
        'Diary retrieval failed, proceeding without',
      );
    }

    const codeContext = [args.codeContext, diaryContext]
      .filter(Boolean)
      .join('\n\n---\n\n');

    const result = await deps.agent.forward(deps.studentAi, {
      question: args.question,
      codeContext: codeContext || undefined,
    });

    const traces = await deps.agent.getTraces({ limit: 1 });
    const latestTrace = traces[0];

    if (latestTrace) {
      deps.traceIndex.set(thisIndex, latestTrace.id);
    }

    return textResult({
      answer: result.answer,
      confidence: result.confidence,
      traceIndex: thisIndex,
    });
  } catch (err) {
    deps.logger.error({ err }, 'legreffier_ask failed');
    return errorResult(
      err instanceof Error ? err.message : 'Forward call failed',
    );
  }
}

export async function handleFeedback(
  args: FeedbackInput,
  deps: LocalMcpDeps,
): Promise<CallToolResult> {
  deps.lastActivity = Date.now();

  const targetIndex = args.traceIndex ?? deps.traceCounter;
  const traceId = deps.traceIndex.get(targetIndex);

  if (!traceId) {
    return errorResult(
      `No trace found at index ${targetIndex}. Run legreffier_ask first.`,
    );
  }

  const feedback: { score?: number; label?: string; comment?: string } = {
    score: args.score,
  };
  if (args.label) feedback.label = args.label;
  if (args.comment) feedback.comment = args.comment;

  try {
    await deps.agent.addFeedback(traceId, feedback);
    return textResult({
      success: true,
      traceIndex: targetIndex,
      feedback,
    });
  } catch (err) {
    deps.logger.error({ err }, 'legreffier_feedback failed');
    return errorResult(err instanceof Error ? err.message : 'Feedback failed');
  }
}

export async function handleTraces(
  args: TracesInput,
  deps: LocalMcpDeps,
): Promise<CallToolResult> {
  deps.lastActivity = Date.now();

  const traces = await deps.agent.getTraces({ limit: args.limit ?? 5 });

  const formatted = traces.map((t, i) => ({
    index: deps.traceCounter - i,
    question: t.input.question,
    answer: truncate(
      typeof t.output.answer === 'string'
        ? t.output.answer
        : JSON.stringify(t.output.answer ?? ''),
      100,
    ),
    confidence: t.output.confidence,
    score: t.feedback?.score ?? null,
    label: t.feedback?.label ?? null,
    durationMs: t.durationMs,
    time: t.startTime,
  }));

  return textResult({ traces: formatted });
}

export async function handleOptimize(
  args: OptimizeInput,
  deps: LocalMcpDeps,
): Promise<CallToolResult> {
  deps.lastActivity = Date.now();
  deps.logger.info('Starting optimization...');

  try {
    const result = await deps.agent.optimize({
      budget: args.budget,
    });

    return textResult({
      score: result.score,
      checkpointVersion: result.checkpointVersion,
      stats: result.stats,
    });
  } catch (err) {
    deps.logger.error({ err }, 'legreffier_optimize failed');
    return errorResult(
      err instanceof Error ? err.message : 'Optimization failed',
    );
  }
}

export async function handleStatus(
  deps: LocalMcpDeps,
): Promise<CallToolResult> {
  deps.lastActivity = Date.now();

  const traces = await deps.agent.getTraces({ limit: 100 });
  const scores = traces
    .map((t) => t.feedback?.score)
    .filter((s): s is number => s !== undefined);
  const avgScore =
    scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null;

  const instruction = deps.agent.getGen().getInstruction();

  return textResult({
    sessionId: deps.sessionId,
    traceCount: traces.length,
    tracesWithFeedback: scores.length,
    avgScore,
    currentInstruction: instruction ? truncate(instruction, 200) : null,
    uptimeSeconds: Math.round((Date.now() - deps.startTime) / 1000),
  });
}

// ── Registration ──────────────────────────────────────

export function registerTools(
  fastify: FastifyInstance,
  deps: LocalMcpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'legreffier_ask',
      description:
        'Ask a question about the codebase. The answer is traced and can receive feedback for self-improvement.',
      inputSchema: AskSchema,
    },
    async (args: AskInput) => handleAsk(args, deps),
  );

  fastify.mcpAddTool(
    {
      name: 'legreffier_feedback',
      description:
        'Give feedback on a previous answer. Score 0-1 (0=bad, 1=good). Targets latest trace by default.',
      inputSchema: FeedbackSchema,
    },
    async (args: FeedbackInput) => handleFeedback(args, deps),
  );

  fastify.mcpAddTool(
    {
      name: 'legreffier_traces',
      description:
        'List recent traces (questions + answers + scores) from this session.',
      inputSchema: TracesSchema,
    },
    async (args: TracesInput) => handleTraces(args, deps),
  );

  fastify.mcpAddTool(
    {
      name: 'legreffier_optimize',
      description:
        'Run batch optimization. Teacher model reviews traces with feedback and produces an improved checkpoint.',
      inputSchema: OptimizeSchema,
    },
    async (args: OptimizeInput) => handleOptimize(args, deps),
  );

  fastify.mcpAddTool(
    {
      name: 'legreffier_status',
      description:
        'Show session status: trace count, avg score, checkpoint info.',
      inputSchema: StatusSchema,
    },
    async () => handleStatus(deps),
  );
}
