/**
 * Reproduce the DBOS TracerProvider race condition.
 *
 * Production error:
 *   Error: @opentelemetry/api: Attempted duplicate registration of API: trace
 *       at TraceAPI.setGlobalTracerProvider
 *       at new Tracer (DBOS SDK)
 *
 * This test simulates the exact bootstrap.ts sequence:
 * 1. initObservability() registers our NodeTracerProvider (with exporter)
 * 2. DBOS.launch() tries to register its own BasicTracerProvider
 * 3. Verify our provider wins and DBOS spans flow through it
 */
import { context, propagation, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it } from 'vitest';

import { createTraceProvider } from '../src/tracing.js';

describe('DBOS TracerProvider race condition', () => {
  afterEach(() => {
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it('our provider wins when registered first — DBOS spans flow through it', () => {
    // ── Step 1: Simulate initObservability() ──
    const exporter = new InMemorySpanExporter();
    const ourProvider = createTraceProvider({
      serviceName: 'moltnet-rest-api',
      exporter,
      processor: new SimpleSpanProcessor(exporter),
    });
    ourProvider.register(); // sets global TracerProvider + context manager

    // Verify our provider is global
    const tracerBefore = trace.getTracer('test');
    const testSpan = tracerBefore.startSpan('test-span');
    testSpan.end();
    expect(exporter.getFinishedSpans()).toHaveLength(1);
    exporter.reset();

    // ── Step 2: Simulate isTraceContextWorking() ──
    // DBOS checks if context propagation works
    let contextWorks = false;
    const checkTracer = trace.getTracer('dbos-check');
    const checkSpan = checkTracer.startSpan('context-check');
    const checkCtx = trace.setSpan(context.active(), checkSpan);
    context.with(checkCtx, () => {
      const activeSpan = trace.getSpan(context.active());
      contextWorks = activeSpan !== undefined;
    });
    checkSpan.end();

    expect(contextWorks).toBe(true); // DBOS skips installTraceContextManager

    // ── Step 3: Simulate DBOS's setGlobalTracerProvider (should be no-op) ──
    const dbosProvider = new BasicTracerProvider({});
    const secondResult = trace.setGlobalTracerProvider(dbosProvider);
    expect(secondResult).toBe(false); // first registration already happened

    // ── Step 4: Verify DBOS-style spans still flow through our provider ──
    exporter.reset();
    const dbosTracer = trace.getTracer('dbos-tracer');
    const workflowSpan = dbosTracer.startSpan('DBOS.workflow:myWorkflow');
    workflowSpan.end();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('DBOS.workflow:myWorkflow');
  });

  it('registration order matches bootstrap.ts: both Fastify and DBOS spans captured', () => {
    const exporter = new InMemorySpanExporter();

    // ── initObservability() ── (bootstrap.ts:97)
    const provider = createTraceProvider({
      serviceName: 'moltnet-rest-api',
      serviceVersion: '0.1.0',
      environment: 'test',
      exporter,
      processor: new SimpleSpanProcessor(exporter),
    });
    provider.register();

    // ── dbosPlugin → DBOS.launch() ── (bootstrap.ts:181)
    // Simulate the setGlobalTracerProvider call that causes the prod error
    const dbosBasicProvider = new BasicTracerProvider({});
    const overwriteResult = trace.setGlobalTracerProvider(dbosBasicProvider);
    expect(overwriteResult).toBe(false); // no-op

    // ── Verify both Fastify and DBOS spans are captured ──
    const fastifyTracer = trace.getTracer('@fastify/otel');
    const dbosTracer = trace.getTracer('dbos-tracer');

    const httpSpan = fastifyTracer.startSpan('GET /health');
    httpSpan.end();

    const workflowSpan = dbosTracer.startSpan(
      'DBOS.workflow:registrationWorkflow',
    );
    workflowSpan.end();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    expect(spans.map((s) => s.name)).toContain('GET /health');
    expect(spans.map((s) => s.name)).toContain(
      'DBOS.workflow:registrationWorkflow',
    );
  });

  it('context propagation works across DBOS-style workflow → step nesting', () => {
    const exporter = new InMemorySpanExporter();
    const provider = createTraceProvider({
      serviceName: 'moltnet-rest-api',
      exporter,
      processor: new SimpleSpanProcessor(exporter),
    });
    provider.register();

    // Simulate DBOS workflow with nested step spans using startActiveSpan
    // (which automatically sets the span as active in context)
    const tracer = trace.getTracer('dbos-tracer');

    tracer.startActiveSpan('DBOS.workflow:register', (workflowSpan) => {
      tracer.startActiveSpan('DBOS.step:createAgent', (stepSpan) => {
        stepSpan.end();
      });
      workflowSpan.end();
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);

    const step = spans.find((s) => s.name === 'DBOS.step:createAgent')!;
    const workflow = spans.find((s) => s.name === 'DBOS.workflow:register')!;

    // Step should be a child of the workflow span (same trace, parent link)
    expect(step.parentSpanContext?.spanId).toBe(workflow.spanContext().spanId);
    expect(step.spanContext().traceId).toBe(workflow.spanContext().traceId);
  });
});
