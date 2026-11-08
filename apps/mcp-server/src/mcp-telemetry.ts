/**
 * OpenTelemetry spans for MCP operations.
 *
 * `@modelcontextprotocol/server` emits no telemetry, so the registry wraps
 * each tool call, resource read and prompt get in a span here, using the MCP
 * semantic-convention attributes. Spans are children of the HTTP request span
 * `@fastify/otel` creates; without a registered tracer provider they are
 * no-ops.
 */
import {
  type Attributes,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

/** https://opentelemetry.io/docs/specs/semconv/registry/attributes/mcp/ */
export const MCP_ATTR = {
  METHOD_NAME: 'mcp.method.name',
  TOOL_NAME: 'mcp.tool.name',
  RESOURCE_URI: 'mcp.resource.uri',
  PROMPT_NAME: 'mcp.prompt.name',
} as const;

const TRACER_NAME = 'moltnet-mcp';

function recordFailure(span: Span, errorType: string, message?: string): void {
  span.setAttribute('error.type', errorType);
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

/**
 * Run `fn` inside a span named `<method> <target>`. A thrown error is
 * recorded and rethrown; a result `isFailure` flags (a tool result with
 * `isError`) marks the span as failed with `error.type: tool_error`.
 */
export function withMcpSpan<T>(
  method: string,
  target: string,
  attributes: Attributes,
  fn: () => Promise<T>,
  isFailure?: (result: T) => boolean,
): Promise<T> {
  return trace.getTracer(TRACER_NAME).startActiveSpan(
    `${method} ${target}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: { [MCP_ATTR.METHOD_NAME]: method, ...attributes },
    },
    async (span) => {
      try {
        const result = await fn();
        if (isFailure?.(result)) recordFailure(span, 'tool_error');
        else span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error as Error);
        recordFailure(
          span,
          error instanceof Error ? error.name : 'Error',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Tag the active (HTTP request) span with the JSON-RPC method and target, so
 * every MCP method is visible, including the ones the SDK answers itself.
 */
export function annotateRequestSpan(body: unknown): void {
  const span = trace.getActiveSpan();
  if (!span || typeof body !== 'object' || body === null) return;
  const { method, params } = body as {
    method?: unknown;
    params?: { name?: unknown; uri?: unknown };
  };
  if (typeof method !== 'string') return;
  span.setAttribute(MCP_ATTR.METHOD_NAME, method);
  if (method === 'tools/call' && typeof params?.name === 'string') {
    span.setAttribute(MCP_ATTR.TOOL_NAME, params.name);
  } else if (method === 'prompts/get' && typeof params?.name === 'string') {
    span.setAttribute(MCP_ATTR.PROMPT_NAME, params.name);
  } else if (method === 'resources/read' && typeof params?.uri === 'string') {
    span.setAttribute(MCP_ATTR.RESOURCE_URI, params.uri);
  }
}
