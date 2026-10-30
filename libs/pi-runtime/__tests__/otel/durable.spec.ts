import type {
  TelemetryCarrier,
  TelemetrySpan,
} from '@earendil-works/pi-telemetry';
import {
  createTraceState,
  propagation,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPiTelemetry } from '../../src/otel/durable.js';

function setup() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer('pi-test');
  return {
    exporter,
    provider,
    tracer,
    telemetry: createPiTelemetry({
      tracer,
      parentContext: propagation.setBaggage(
        ROOT_CONTEXT,
        propagation.createBaggage({ private: { value: 'not-for-storage' } }),
      ),
    }),
  };
}

describe('native Pi OTel bridge', () => {
  beforeAll(() => {
    propagation.setGlobalPropagator(
      new CompositePropagator({
        propagators: [
          new W3CTraceContextPropagator(),
          new W3CBaggagePropagator(),
        ],
      }),
    );
  });
  afterAll(() => {
    propagation.disable();
  });

  it('parents native spans under the host trace and preserves nested events and results', async () => {
    const { exporter, provider, tracer } = setup();
    const host = tracer.startSpan('host');
    const telemetry = createPiTelemetry({
      tracer,
      parentContext: trace.setSpan(ROOT_CONTEXT, host),
    });
    try {
      expect(
        await telemetry.startSpan(
          { name: 'pi.durable.submit' },
          async (submit) => {
            submit.addEvent('accepted', { count: 1, omitted: undefined });
            return submit.startSpan(
              { name: 'pi.ai.request', attributes: { model: 'faux' } },
              (request) => {
                request.setAttributes({ tokens: 12 });
                return 42;
              },
            );
          },
        ),
      ).toBe(42);
      const spans = exporter.getFinishedSpans();
      const submit = spans.find((s) => s.name === 'pi.durable.submit')!;
      const request = spans.find((s) => s.name === 'pi.ai.request')!;
      expect(submit.parentSpanContext?.spanId).toBe(host.spanContext().spanId);
      expect(request.parentSpanContext?.spanId).toBe(
        submit.spanContext().spanId,
      );
      expect(request.spanContext().traceId).toBe(host.spanContext().traceId);
      expect(submit.events[0].attributes).toEqual({ count: 1 });
      expect(request.attributes).toEqual({ model: 'faux', tokens: 12 });
      expect(request.status.code).toBe(SpanStatusCode.OK);
    } finally {
      host.end();
      await provider.shutdown();
    }
  });

  it('resumes from a serialized carrier and links to a settled span without carrying baggage', async () => {
    const { exporter, provider, tracer } = setup();
    const telemetry = createPiTelemetry({
      tracer,
      parentContext: propagation.setBaggage(
        trace.setSpanContext(ROOT_CONTEXT, {
          traceId: '12345678901234567890123456789012',
          spanId: '1234567890123456',
          traceFlags: 1,
          traceState: createTraceState('vendor=opaque'),
        }),
        propagation.createBaggage({ private: { value: 'not-for-storage' } }),
      ),
    });
    let carrier: TelemetryCarrier | undefined;
    let settled: TelemetrySpan | undefined;
    try {
      await telemetry.startSpan({ name: 'before-restart' }, (span) => {
        settled = span;
        carrier = span.propagation!.inject(span);
      });
      expect(Object.keys(carrier!).sort()).toEqual([
        'traceparent',
        'tracestate',
      ]);
      expect(carrier!.tracestate).toBe('vendor=opaque');
      const fresh = createPiTelemetry({ tracer, parentContext: ROOT_CONTEXT });
      const persisted = JSON.parse(JSON.stringify(carrier)) as TelemetryCarrier;
      const parent = fresh.propagation!.extract({
        ...persisted,
        baggage: 'private=value',
      });
      expect(parent.metrics).toBeDefined();
      expect(parent.propagation!.inject(parent)).toEqual(carrier);
      await parent.startSpan(
        { name: 'resumed', links: [{ context: parent }] },
        (span) => {
          span.addLink({ context: settled!, attributes: { reason: 'resume' } });
        },
      );
      const [original, resumed] = exporter.getFinishedSpans();
      expect(resumed.parentSpanContext?.spanId).toBe(
        original.spanContext().spanId,
      );
      expect(resumed.spanContext().traceId).toBe(
        original.spanContext().traceId,
      );
      expect(resumed.spanContext().traceState?.serialize()).toBe(
        'vendor=opaque',
      );
      expect(resumed.links).toHaveLength(2);
      expect(resumed.links[1].attributes).toEqual({ reason: 'resume' });
      await fresh
        .propagation!.extract({ traceparent: 'invalid' })
        .startSpan({ name: 'root' }, () => undefined);
      expect(exporter.getFinishedSpans()[2].parentSpanContext).toBeUndefined();
    } finally {
      await provider.shutdown();
    }
  });

  it('keeps callbacks inert after settlement while retaining propagation identity', async () => {
    const { exporter, provider, telemetry } = setup();
    let settled: TelemetrySpan | undefined;
    try {
      await telemetry.startSpan({ name: 'finished' }, (span) => {
        settled = span;
      });
      settled!.addEvent('too-late');
      settled!.setAttributes({ late: true });
      expect(
        await settled!.startSpan({ name: 'too-late' }, (span) => {
          expect(span.metrics).toBeDefined();
          expect(span.propagation).toBeDefined();
          return 7;
        }),
      ).toBe(7);
      expect(settled!.propagation!.inject(settled!)).toHaveProperty(
        'traceparent',
      );
      expect(exporter.getFinishedSpans()).toHaveLength(1);
      expect(exporter.getFinishedSpans()[0].events).toEqual([]);
      expect(exporter.getFinishedSpans()[0].attributes).toEqual({});
    } finally {
      await provider.shutdown();
    }
  });

  it('preserves rejection identity and explicit status without exporting raw error text', async () => {
    const { exporter, provider, telemetry } = setup();
    const failure = new Error('private provider payload');
    try {
      await expect(
        telemetry.startSpan({ name: 'failed' }, () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      await expect(
        telemetry.startSpan({ name: 'cancelled' }, (span) => {
          span.setStatus({
            status: 'error',
            error: { name: 'provider_error', message: failure.message },
          });
          span.setStatus({ status: 'ok' });
          throw failure;
        }),
      ).rejects.toBe(failure);
      await telemetry.startSpan({ name: 'classified' }, (span) => {
        span.setStatus({
          status: 'error',
          error: { name: 'provider_error', message: failure.message },
        });
      });
      const spans = exporter.getFinishedSpans();
      expect(spans.map((span) => span.status)).toEqual([
        { code: SpanStatusCode.ERROR, message: 'pi_error' },
        { code: SpanStatusCode.OK },
        { code: SpanStatusCode.ERROR, message: 'provider_error' },
      ]);
      expect(
        JSON.stringify(
          spans.map((span) => ({
            status: span.status,
            attributes: span.attributes,
            events: span.events,
          })),
        ),
      ).not.toContain(failure.message);
    } finally {
      await provider.shutdown();
    }
  });

  it('records native counters and histograms through the host meter', async () => {
    const exporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const provider = new MeterProvider({
      readers: [
        new PeriodicExportingMetricReader({
          exporter,
          exportIntervalMillis: 60_000,
        }),
      ],
    });
    try {
      const telemetry = createPiTelemetry({
        meter: provider.getMeter('pi-test'),
      });
      telemetry.metrics!.counter('requests').add(2, { provider: 'faux' });
      telemetry.metrics!.upDownCounter('active').add(1);
      telemetry.metrics!.upDownCounter('active').add(-1);
      await telemetry.startSpan({ name: 'phase' }, (span) => {
        span
          .metrics!.histogram('duration', { unit: 's', boundaries: [1, 5] })
          .record(3, { phase: 'tool' }, span);
      });
      await provider.forceFlush();
      const metrics = exporter
        .getMetrics()
        .flatMap((resource) =>
          resource.scopeMetrics.flatMap((scope) => scope.metrics),
        );
      expect(
        metrics.find((metric) => metric.descriptor.name === 'requests')
          ?.dataPoints[0],
      ).toMatchObject({ value: 2, attributes: { provider: 'faux' } });
      expect(
        metrics.find((metric) => metric.descriptor.name === 'active')
          ?.dataPoints[0],
      ).toMatchObject({ value: 0 });
      expect(
        metrics.find((metric) => metric.descriptor.name === 'duration')
          ?.dataPoints[0],
      ).toMatchObject({
        value: { count: 1, sum: 3, buckets: { boundaries: [1, 5] } },
        attributes: { phase: 'tool' },
      });
    } finally {
      await provider.shutdown();
    }
  });

  it('works without a host SDK', async () => {
    const telemetry = createPiTelemetry();
    expect(
      await telemetry.startSpan({ name: 'noop' }, (span) => {
        span.addEvent('event');
        span.metrics!.counter('requests').add(1);
        expect(span.propagation!.inject(span)).toBeUndefined();
        return 'done';
      }),
    ).toBe('done');
  });
});
