import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ROOT_CONTEXT, SpanStatusCode, trace } from '@opentelemetry/api';
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
import type { ClaimedTask } from '@themoltnet/agent-runtime';
import { expect, it, vi } from 'vitest';

import { createPiTelemetry } from '../../src/otel/durable.js';
import { writePiConfig } from '../../src/pi-config.js';
import {
  createClassificationTaskExecutor,
  createRuntimeModels,
} from '../../src/runtime/model-runtime.js';

it.each(['success', 'malformed', 'missing-usage', 'unpriced', 'cancelled'])(
  'reconciles classifier task usage with exported metrics on %s',
  async (scenario) => {
    const piDir = mkdtempSync(join(tmpdir(), 'classifier-telemetry-'));
    const spans = new InMemorySpanExporter();
    const traces = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spans)],
    });
    const exported = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const metrics = new MeterProvider({
      readers: [
        new PeriodicExportingMetricReader({
          exporter: exported,
          exportIntervalMillis: 60_000,
        }),
      ],
    });
    const tracer = traces.getTracer('classifier-test');
    const host = tracer.startSpan('host');
    try {
      writePiConfig({
        piDir,
        providers: {
          local: {
            api: 'typesafe-system-one',
            baseUrl: 'http://localhost:11434/v1',
            models: [
              {
                id: 'decision',
                type: 'classifier',
                ...(scenario === 'unpriced'
                  ? {}
                  : {
                      cost: {
                        input: 2,
                        output: 4,
                        cacheRead: 0,
                        cacheWrite: 0,
                      },
                    }),
              },
            ],
          },
        },
      });
      const models = await createRuntimeModels(piDir);
      const model = models.getModelOfType('classifier', 'local', 'decision')!;
      const telemetry = createPiTelemetry({
        tracer,
        meter: metrics.getMeter('classifier-test'),
        parentContext: trace.setSpan(ROOT_CONTEXT, host),
      });
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(
          new Response('busy', {
            status: 503,
            headers: { 'retry-after-ms': '1' },
          }),
        )
        .mockImplementation(() =>
          Promise.resolve(
            Response.json({
              answers:
                scenario === 'malformed'
                  ? {}
                  : { actionable: { type: 'noul', noul: 0.8 } },
              ...(scenario === 'missing-usage'
                ? {}
                : { usage: { input_tokens: 100, output_tokens: 2 } }),
            }),
          ),
        );
      const signal =
        scenario === 'cancelled'
          ? AbortSignal.abort()
          : new AbortController().signal;
      const reporter = {
        open: vi.fn(),
        record: vi.fn(),
        close: vi.fn(),
        finalize: vi.fn(),
        cancelSignal: signal,
        cancelReason: null,
      };
      const result = await telemetry.startSpan(
        { name: 'classification-task' },
        (active) =>
          createClassificationTaskExecutor({
            model,
            models: {
              classify: (model, input, options) =>
                models.classify(model, input, {
                  ...options,
                  fetch,
                  telemetry: active,
                }),
            },
          })(
            {
              task: {
                id: 'task',
                taskType: 'classify',
                input: {
                  version: 1,
                  state: { private: 'private input text' },
                  questions: {
                    actionable: {
                      type: 'bool',
                      instructions: 'private instructions',
                      criteria: { true: 'yes', false: 'no' },
                    },
                  },
                },
              },
              attemptN: 1,
            } as unknown as ClaimedTask,
            reporter,
          ),
      );
      await metrics.forceFlush();
      const points = exported
        .getMetrics()
        .flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics));
      const requests = spans
        .getFinishedSpans()
        .filter((s) => s.name === 'pi.ai.request');
      if (scenario === 'cancelled') {
        expect(result.status).toBe('cancelled');
        expect(fetch).not.toHaveBeenCalled();
        expect(requests).toHaveLength(0);
        expect(points).toHaveLength(0);
        return;
      }
      expect(fetch).toHaveBeenCalledTimes(2);
      for (const [, init] of fetch.mock.calls)
        expect(new Headers(init?.headers).get('authorization')).toBeNull();
      expect(requests).toHaveLength(1);
      const taskSpan = spans
        .getFinishedSpans()
        .find((s) => s.name === 'classification-task')!;
      expect(taskSpan.parentSpanContext?.spanId).toBe(
        host.spanContext().spanId,
      );
      expect(requests[0].parentSpanContext?.spanId).toBe(
        taskSpan.spanContext().spanId,
      );
      expect(requests[0].status.code).toBe(
        scenario === 'malformed' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
      );
      expect(result.status).toBe(
        scenario === 'malformed' ? 'failed' : 'completed',
      );
      expect(reporter.finalize).toHaveBeenCalledWith(result.usage);
      const costs = points.find((m) => m.descriptor.name === 'pi.ai.cost');
      const tokens = points.find((m) => m.descriptor.name === 'pi.ai.tokens');
      if (scenario === 'missing-usage') {
        expect(costs).toBeUndefined();
        expect(tokens).toBeUndefined();
        expect(result.usage.cost).toBeUndefined();
      } else {
        expect(
          tokens?.dataPoints.find((p) => p.attributes.kind === 'input')?.value,
        ).toBe(result.usage.inputTokens);
        expect(
          tokens?.dataPoints.find((p) => p.attributes.kind === 'output')?.value,
        ).toBe(result.usage.outputTokens);
        expect(result.usage.inputTokens).toBe(100);
        expect(costs?.dataPoints).toHaveLength(1);
        expect(costs?.dataPoints[0].attributes).toEqual({
          provider: 'local',
          model: 'decision',
        });
        if (scenario === 'unpriced') {
          expect(costs?.dataPoints[0].value).toBe(0);
          expect(result.usage.cost).toBeUndefined();
        } else {
          expect(result.usage.cost?.total).toBeCloseTo(0.000208);
          expect(costs?.dataPoints[0].value).toBe(result.usage.cost?.total);
        }
      }
      expect(JSON.stringify(points)).not.toContain('private input text');
      expect(JSON.stringify(requests.map((s) => s.attributes))).not.toContain(
        'private instructions',
      );
    } finally {
      host.end();
      await metrics.shutdown();
      await traces.shutdown();
      rmSync(piDir, { recursive: true, force: true });
    }
  },
);
