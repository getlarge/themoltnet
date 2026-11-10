import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Writable } from 'node:stream';

import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import pino from 'pino';
import { expect, it } from 'vitest';

import { createLogger } from '../src/logger.js';
import { createMeterProvider } from '../src/metrics.js';
import { SERVICE_INSTANCE_ID } from '../src/service-instance.js';
import { createTraceProvider } from '../src/tracing.js';
import { TestMetricReader } from './test-metric-reader.js';

it('exports the same process ID from metrics, traces and the Pino worker', async () => {
  const received: Array<{ key: string; value: { stringValue: string } }> = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => {
      received.push(...JSON.parse(body).resourceLogs[0].resource.attributes);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const reader = new TestMetricReader();
  const metrics = createMeterProvider({
    serviceName: 'correlation-test',
    reader,
  });
  const exporter = new InMemorySpanExporter();
  const traces = createTraceProvider({
    serviceName: 'correlation-test',
    processor: new SimpleSpanProcessor(exporter),
  });
  const logger = createLogger({
    serviceName: 'correlation-test',
    otelEnabled: true,
    logRecordProcessorOptions: [
      {
        recordProcessorType: 'simple',
        exporterOptions: {
          protocol: 'http',
          httpExporterOptions: {
            url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/logs`,
          },
        },
      },
    ],
  });
  try {
    metrics.getMeter('test').createCounter('test').add(1);
    traces.getTracer('test').startSpan('probe').end();
    logger.info('correlation probe');
    await expect
      .poll(
        () =>
          received.find((a) => a.key === 'service.instance.id')?.value
            .stringValue,
      )
      .toBe(SERVICE_INSTANCE_ID);
    expect(
      (await reader.collect()).resourceMetrics.resource.attributes[
        'service.instance.id'
      ],
    ).toBe(SERVICE_INSTANCE_ID);
    expect(
      exporter.getFinishedSpans()[0].resource.attributes['service.instance.id'],
    ).toBe(SERVICE_INSTANCE_ID);
    expect(logger.bindings()['service.instance.id']).toBe(SERVICE_INSTANCE_ID);
  } finally {
    const stream = Reflect.get(logger, pino.symbols.streamSym) as Writable;
    const closed = once(stream, 'close');
    stream.end();
    await closed;
    await Promise.all([metrics.shutdown(), traces.shutdown()]);
    server.close();
    await once(server, 'close');
  }
}, 15_000);
