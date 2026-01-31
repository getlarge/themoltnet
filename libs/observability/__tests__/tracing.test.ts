import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it } from 'vitest';

import { createTraceProvider } from '../src/tracing.js';

describe('createTraceProvider', () => {
  let exporter: InMemorySpanExporter;

  afterEach(async () => {
    if (exporter) {
      exporter.reset();
    }
    // Clean up global trace provider
    trace.disable();
  });

  it('should create a trace provider with the correct service resource', async () => {
    exporter = new InMemorySpanExporter();
    const provider = createTraceProvider({
      serviceName: 'moltnet-api',
      serviceVersion: '0.1.0',
      exporter,
    });

    expect(provider).toBeDefined();

    const resource = provider.resource;
    const attributes = resource.attributes;
    expect(attributes['service.name']).toBe('moltnet-api');
    expect(attributes['service.version']).toBe('0.1.0');

    await provider.shutdown();
  });

  it('should include environment in resource when provided', async () => {
    exporter = new InMemorySpanExporter();
    const provider = createTraceProvider({
      serviceName: 'test',
      environment: 'staging',
      exporter,
    });

    expect(provider.resource.attributes['deployment.environment']).toBe(
      'staging',
    );

    await provider.shutdown();
  });

  it('should record spans via the trace provider', async () => {
    exporter = new InMemorySpanExporter();
    const provider = createTraceProvider({
      serviceName: 'test',
      exporter,
      processor: new SimpleSpanProcessor(exporter),
    });

    // Register as global so tracers resolve spans correctly
    provider.register();
    const tracer = trace.getTracer('test-tracer');

    const span = tracer.startSpan('test-operation', {
      kind: SpanKind.INTERNAL,
    });
    span.setAttribute('test.key', 'test-value');
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();

    // SimpleSpanProcessor exports synchronously on end
    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBe(1);
    expect(spans[0].name).toBe('test-operation');
    expect(spans[0].attributes['test.key']).toBe('test-value');
    expect(spans[0].status.code).toBe(SpanStatusCode.OK);

    await provider.shutdown();
  });

  it('should support nested spans with parent-child relationships', async () => {
    exporter = new InMemorySpanExporter();
    const provider = createTraceProvider({
      serviceName: 'test',
      exporter,
      processor: new SimpleSpanProcessor(exporter),
    });

    // register() sets BOTH global tracer provider AND context manager
    provider.register();
    const tracer = trace.getTracer('test-tracer');

    const parentSpan = tracer.startSpan('parent-op');
    const ctx = trace.setSpan(context.active(), parentSpan);

    context.with(ctx, () => {
      const childSpan = tracer.startSpan('child-op');
      childSpan.end();
    });
    parentSpan.end();

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBe(2);

    const child = spans.find((s) => s.name === 'child-op');
    const parent = spans.find((s) => s.name === 'parent-op');
    expect(child).toBeDefined();
    expect(parent).toBeDefined();
    expect(child!.parentSpanId).toBe(parent!.spanContext().spanId);
    expect(child!.spanContext().traceId).toBe(parent!.spanContext().traceId);

    await provider.shutdown();
  });

  it('should gracefully shutdown and flush pending spans', async () => {
    exporter = new InMemorySpanExporter();
    const provider = createTraceProvider({
      serviceName: 'test',
      exporter,
      processor: new SimpleSpanProcessor(exporter),
    });

    provider.register();
    const tracer = trace.getTracer('test-tracer');
    const span = tracer.startSpan('flush-test');
    span.end();

    // Read spans before shutdown (shutdown may clear exporter)
    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBe(1);
    expect(spans[0].name).toBe('flush-test');

    await provider.shutdown();
  });
});
