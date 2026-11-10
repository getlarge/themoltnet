import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  context,
  propagation,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Type } from 'typebox';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { McpRegistry } from '../src/mcp-registry.js';
import { annotateRequestSpan, MCP_ATTR } from '../src/mcp-telemetry.js';
import { oauthScopes } from '../src/tool-security.js';
import { errorResult, textResult } from '../src/utils.js';

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  // Registers the async context manager too, as the production bootstrap
  // does, so active spans propagate across awaits.
  new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  }).register();
});

afterAll(() => {
  trace.disable();
  context.disable();
  propagation.disable();
});

beforeEach(() => {
  exporter.reset();
});

async function rpc(
  registry: McpRegistry,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  const handler = createMcpHandler(() =>
    registry.createServer({ name: 'test', version: '0.0.0' }),
  );
  const response = await handler.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  await response.text();
  await handler.close();
}

function registryWith(
  handler: () => ReturnType<typeof textResult> | never,
): McpRegistry {
  const registry = new McpRegistry();
  registry.mcpAddTool(
    {
      name: 'diaries_list',
      inputSchema: Type.Object({}),
      _meta: { securitySchemes: oauthScopes('diary:read') },
    },
    handler,
  );
  registry.mcpAddResource(
    {
      name: 'diary',
      uriPattern: 'moltnet://diaries/{diaryId}',
      mimeType: 'application/json',
    },
    (uri) => ({ contents: [{ uri, text: '{}' }] }),
  );
  registry.mcpAddPrompt(
    {
      name: 'sign_message',
      arguments: [{ name: 'message', required: true }],
    },
    () => ({ messages: [] }),
  );
  return registry;
}

describe('MCP spans', () => {
  it('records a successful tool call with the semconv attributes', async () => {
    // Arrange
    const registry = registryWith(() => textResult({ items: [] }));

    // Act
    await rpc(registry, 'tools/call', { name: 'diaries_list', arguments: {} });

    // Assert
    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe('tools/call diaries_list');
    expect(span?.attributes).toMatchObject({
      [MCP_ATTR.METHOD_NAME]: 'tools/call',
      [MCP_ATTR.TOOL_NAME]: 'diaries_list',
    });
    expect(span?.status.code).toBe(SpanStatusCode.OK);
  });

  it('marks a tool error result as failed', async () => {
    const registry = registryWith(() => errorResult('Diary not found'));

    await rpc(registry, 'tools/call', { name: 'diaries_list', arguments: {} });

    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.attributes['error.type']).toBe('tool_error');
  });

  it('records a thrown handler error', async () => {
    const registry = registryWith(() => {
      throw new TypeError('boom');
    });

    await rpc(registry, 'tools/call', { name: 'diaries_list', arguments: {} });

    const [span] = exporter.getFinishedSpans();
    expect(span?.status).toMatchObject({
      code: SpanStatusCode.ERROR,
      message: 'boom',
    });
    expect(span?.attributes['error.type']).toBe('TypeError');
    expect(span?.events.map((event) => event.name)).toContain('exception');
  });

  it('records resource reads and prompt gets', async () => {
    const registry = registryWith(() => textResult({}));

    await rpc(registry, 'resources/read', { uri: 'moltnet://diaries/d-1' });
    await rpc(registry, 'prompts/get', {
      name: 'sign_message',
      arguments: { message: 'hi' },
    });

    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual([
      'resources/read moltnet://diaries/d-1',
      'prompts/get sign_message',
    ]);
    expect(spans[0]?.attributes[MCP_ATTR.RESOURCE_URI]).toBe(
      'moltnet://diaries/d-1',
    );
    expect(spans[1]?.attributes[MCP_ATTR.PROMPT_NAME]).toBe('sign_message');
  });

  it('tags the request span with the JSON-RPC method and tool', () => {
    trace.getTracer('test').startActiveSpan('POST /mcp', (span) => {
      annotateRequestSpan({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'entries_search' },
      });
      span.end();
    });

    const [span] = exporter.getFinishedSpans();
    expect(span?.attributes).toMatchObject({
      [MCP_ATTR.METHOD_NAME]: 'tools/call',
      [MCP_ATTR.TOOL_NAME]: 'entries_search',
    });
  });
});
