/**
 * OTel gen-ai instrumentation for pi sessions, shaped as a pi extension
 * factory so it can be registered via `loadExtensionFromFactory()`.
 *
 * Spans follow OTel gen-ai semconv:
 *   - `invoke_agent <agent.name>`     (root, per session)
 *     └── `chat <model>`              (per LLM turn)
 *           └── `execute_tool <name>` (per tool call)
 *
 * Attributes under the `gen_ai.*` namespace. See:
 *   https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
 *   https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/
 *
 * The root span inherits from `context.active()` — when embedded in
 * `AgentRuntime` (which wraps task execution in `otelContext.with(taskCtx,
 * ...)`), the whole tree lands under the workflow trace automatically.
 *
 * This module uses `@opentelemetry/api` only. If no tracer provider is
 * registered in the host process, all calls become no-ops — the extension
 * is safe to load unconditionally.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
  TurnEndEvent,
  TurnStartEvent,
} from '@mariozechner/pi-coding-agent';
import {
  type Context,
  context as otelContext,
  type Span,
  SpanStatusCode,
  trace,
  type Tracer,
} from '@opentelemetry/api';

// These event shapes are defined in pi-coding-agent but not re-exported
// from the public entry (as of 0.67.68). Declare the minimal shape we use.
interface ModelSelectEvent {
  type: 'model_select';
  model: { provider: string; id: string };
  previousModel?: { provider: string; id: string };
  source?: string;
}
interface ToolExecutionStartEvent {
  type: 'tool_execution_start';
  toolCallId: string;
  toolName: string;
  args: unknown;
}
interface ToolExecutionEndEvent {
  type: 'tool_execution_end';
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

const TRACER_NAME = '@themoltnet/pi-extension/otel';

export interface PiOtelOptions {
  /** Agent name for `gen_ai.agent.name` on the root span. */
  agentName?: string;
  /**
   * Extra attributes merged onto every span. Use MoltNet-specific keys
   * like `moltnet.task.id` — any `gen_ai.*` keys here are filtered out
   * since the extension is authoritative for those.
   */
  spanAttributes?: Record<string, string | number | boolean>;
}

function stripReservedAttrs(
  attrs: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('gen_ai.')) continue;
    out[k] = v;
  }
  return out;
}

export function createPiOtelExtension(options: PiOtelOptions = {}) {
  return function piOtelExtension(pi: ExtensionAPI): void {
    const tracer: Tracer = trace.getTracer(TRACER_NAME);
    const extraAttrs = stripReservedAttrs(options.spanAttributes ?? {});

    // Per-session state. Must be reset on every session_start because a
    // /reload can fire session_start again without a preceding shutdown.
    let sessionSpan: Span | undefined;
    let sessionCtx: Context = otelContext.active();
    let turnSpan: Span | undefined;
    let turnCtx: Context = otelContext.active();
    let currentModel: { provider: string; id: string } | undefined;
    const toolSpans = new Map<string, { span: Span; startedAt: number }>();

    // Drain any open tool spans with an error status. Used when a parent
    // (turn or session) ends before all children have reported — without
    // this, tool spans reference a finished parent and most backends drop
    // them.
    function drainToolSpans(reason: string) {
      for (const [, entry] of toolSpans) {
        entry.span.setStatus({ code: SpanStatusCode.ERROR, message: reason });
        entry.span.end();
      }
      toolSpans.clear();
    }

    function endTurnSpan() {
      if (!turnSpan) return;
      drainToolSpans('tool span not closed before turn end');
      turnSpan.end();
      turnSpan = undefined;
      turnCtx = sessionCtx;
    }

    function endSessionSpan() {
      drainToolSpans('tool span not closed before session shutdown');
      endTurnSpan();
      if (sessionSpan) {
        sessionSpan.setStatus({ code: SpanStatusCode.OK });
        sessionSpan.end();
        sessionSpan = undefined;
        sessionCtx = otelContext.active();
      }
      currentModel = undefined;
    }

    pi.on(
      'session_start',
      (event: SessionStartEvent, ctx: ExtensionContext) => {
        // Defensive: if a previous session_start wasn't matched by a
        // session_shutdown (e.g. /reload path), tear down first so we
        // don't leak a dangling root span.
        endSessionSpan();

        const agentName = options.agentName ?? 'pi';
        sessionSpan = tracer.startSpan(
          `invoke_agent ${agentName}`,
          {
            attributes: {
              ...extraAttrs,
              'gen_ai.operation.name': 'invoke_agent',
              'gen_ai.agent.name': agentName,
              'session.reason': event.reason,
              'session.cwd': ctx.cwd,
            },
          },
          otelContext.active(),
        );
        sessionCtx = trace.setSpan(otelContext.active(), sessionSpan);
        turnCtx = sessionCtx;
      },
    );

    pi.on('session_shutdown', () => {
      endSessionSpan();
    });

    pi.on('model_select', (event: ModelSelectEvent) => {
      currentModel = { provider: event.model.provider, id: event.model.id };
      if (sessionSpan) {
        sessionSpan.setAttribute('gen_ai.request.model', event.model.id);
        sessionSpan.setAttribute('gen_ai.provider.name', event.model.provider);
      }
    });

    pi.on('turn_start', (event: TurnStartEvent) => {
      if (!sessionSpan) return;
      const modelLabel = currentModel?.id ?? 'unknown';
      turnSpan = tracer.startSpan(
        `chat ${modelLabel}`,
        {
          attributes: {
            ...extraAttrs,
            'gen_ai.operation.name': 'chat',
            'gen_ai.request.model': currentModel?.id ?? 'unknown',
            'gen_ai.provider.name': currentModel?.provider ?? 'unknown',
            'turn.index': event.turnIndex,
          },
        },
        sessionCtx,
      );
      turnCtx = trace.setSpan(sessionCtx, turnSpan);
    });

    pi.on('turn_end', (event: TurnEndEvent) => {
      if (!turnSpan) return;
      const usage = extractUsage(event.message);
      if (usage) {
        // gen-ai semconv 1.28+ names (replaced older prompt_tokens /
        // completion_tokens).
        turnSpan.setAttribute('gen_ai.usage.input_tokens', usage.input);
        turnSpan.setAttribute('gen_ai.usage.output_tokens', usage.output);
      }
      turnSpan.setAttribute(
        'turn.tool_results',
        event.toolResults?.length ?? 0,
      );
      turnSpan.setStatus({ code: SpanStatusCode.OK });
      endTurnSpan();
    });

    pi.on('tool_execution_start', (event: ToolExecutionStartEvent) => {
      const parentCtx = turnSpan ? turnCtx : sessionCtx;
      const span = tracer.startSpan(
        `execute_tool ${event.toolName}`,
        {
          attributes: {
            ...extraAttrs,
            'gen_ai.operation.name': 'execute_tool',
            'gen_ai.tool.name': event.toolName,
            'gen_ai.tool.call.id': event.toolCallId,
          },
        },
        parentCtx,
      );
      toolSpans.set(event.toolCallId, { span, startedAt: Date.now() });
    });

    pi.on('tool_execution_end', (event: ToolExecutionEndEvent) => {
      const entry = toolSpans.get(event.toolCallId);
      if (!entry) return;
      const durationMs = Date.now() - entry.startedAt;
      entry.span.setAttribute('tool.duration_ms', durationMs);
      if (event.isError) {
        entry.span.setAttribute('error.type', 'tool_execution_error');
        entry.span.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'tool execution failed',
        });
      } else {
        entry.span.setStatus({ code: SpanStatusCode.OK });
      }
      entry.span.end();
      toolSpans.delete(event.toolCallId);
    });
  };
}

interface UsageShape {
  input: number;
  output: number;
}

function extractUsage(message: unknown): UsageShape | null {
  if (
    !message ||
    typeof message !== 'object' ||
    !('usage' in message) ||
    !('role' in message)
  ) {
    return null;
  }
  const msg = message as {
    role: string;
    usage?: { input?: number; output?: number };
  };
  if (msg.role !== 'assistant' || !msg.usage) return null;
  return {
    input: msg.usage.input ?? 0,
    output: msg.usage.output ?? 0,
  };
}
