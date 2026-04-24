import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPiOtelExtension } from './index.js';

// Minimal in-memory event emitter standing in for pi's ExtensionAPI.
function makeFakePi() {
  const handlers = new Map<
    string,
    ((event: unknown, ctx?: unknown) => void)[]
  >();
  const pi = {
    on(event: string, handler: (event: unknown, ctx?: unknown) => void) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  };
  const emit = (event: string, payload: unknown, ctx: unknown = {}) => {
    for (const h of handlers.get(event) ?? []) h(payload, ctx);
  };
  return { pi: pi as never, emit };
}

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

describe('createPiOtelExtension', () => {
  beforeAll(() => {
    trace.setGlobalTracerProvider(provider);
  });
  afterAll(async () => {
    await provider.shutdown();
  });
  beforeEach(() => {
    exporter.reset();
  });

  it('emits invoke_agent → chat → execute_tool span tree', () => {
    const { pi, emit } = makeFakePi();
    const factory = createPiOtelExtension({
      agentName: 'legreffier',
      spanAttributes: {
        'moltnet.task.id': 'task-123',
        'moltnet.task.attempt': 1,
      },
    });
    factory(pi);

    emit(
      'session_start',
      { type: 'session_start', reason: 'new' },
      { cwd: '/tmp' },
    );
    emit('model_select', {
      type: 'model_select',
      model: { provider: 'anthropic', id: 'claude-sonnet-4-5' },
    });
    emit('turn_start', { type: 'turn_start', turnIndex: 0, timestamp: 0 });
    emit('tool_execution_start', {
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: {},
    });
    emit('tool_execution_end', {
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'bash',
      result: {},
      isError: false,
    });
    emit('turn_end', {
      type: 'turn_end',
      turnIndex: 0,
      message: { role: 'assistant', usage: { input: 42, output: 7 } },
      toolResults: [],
    });
    emit('session_shutdown', { type: 'session_shutdown' });

    const spans = exporter.getFinishedSpans();
    const byName = (name: string) =>
      spans.find((s: ReadableSpan) => s.name === name);

    const agent = byName('invoke_agent legreffier');
    const chat = byName('chat claude-sonnet-4-5');
    const tool = byName('execute_tool bash');

    expect(agent).toBeDefined();
    expect(chat).toBeDefined();
    expect(tool).toBeDefined();

    expect(agent!.attributes['gen_ai.operation.name']).toBe('invoke_agent');
    expect(agent!.attributes['gen_ai.agent.name']).toBe('legreffier');
    expect(agent!.attributes['moltnet.task.id']).toBe('task-123');

    expect(chat!.attributes['gen_ai.operation.name']).toBe('chat');
    expect(chat!.attributes['gen_ai.request.model']).toBe('claude-sonnet-4-5');
    expect(chat!.attributes['gen_ai.provider.name']).toBe('anthropic');
    expect(chat!.attributes['gen_ai.usage.input_tokens']).toBe(42);
    expect(chat!.attributes['gen_ai.usage.output_tokens']).toBe(7);

    expect(tool!.attributes['gen_ai.operation.name']).toBe('execute_tool');
    expect(tool!.attributes['gen_ai.tool.name']).toBe('bash');
    expect(tool!.attributes['gen_ai.tool.call.id']).toBe('call-1');

    // Tree: tool.parent == chat, chat.parent == agent
    expect(tool!.parentSpanContext?.spanId).toBe(chat!.spanContext().spanId);
    expect(chat!.parentSpanContext?.spanId).toBe(agent!.spanContext().spanId);
  });

  it('marks tool span as error when isError is true', () => {
    const { pi, emit } = makeFakePi();
    createPiOtelExtension()(pi);

    emit(
      'session_start',
      { type: 'session_start', reason: 'new' },
      { cwd: '/tmp' },
    );
    emit('turn_start', { type: 'turn_start', turnIndex: 0, timestamp: 0 });
    emit('tool_execution_start', {
      type: 'tool_execution_start',
      toolCallId: 'call-err',
      toolName: 'bash',
      args: {},
    });
    emit('tool_execution_end', {
      type: 'tool_execution_end',
      toolCallId: 'call-err',
      toolName: 'bash',
      result: {},
      isError: true,
    });
    emit('turn_end', {
      type: 'turn_end',
      turnIndex: 0,
      message: { role: 'assistant', usage: { input: 1, output: 1 } },
      toolResults: [],
    });
    emit('session_shutdown', { type: 'session_shutdown' });

    const tool = exporter
      .getFinishedSpans()
      .find((s) => s.name === 'execute_tool bash');
    expect(tool!.attributes['error.type']).toBe('tool_execution_error');
    expect(tool!.status.code).toBe(2); // ERROR
  });
});
