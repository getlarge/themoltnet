import type {
  SpanAttributes,
  SpanLink,
  SpanStatus,
  TelemetryContext,
  TelemetryMetrics,
  TelemetryPropagation,
  TelemetrySpan,
} from '@earendil-works/pi-telemetry';
import { NOOP_TELEMETRY_CONTEXT } from '@earendil-works/pi-telemetry';
import {
  type Attributes,
  type Context,
  context,
  isSpanContextValid,
  type Link,
  type Meter,
  metrics,
  propagation,
  ROOT_CONTEXT,
  type Span,
  SpanStatusCode,
  trace,
  type Tracer,
} from '@opentelemetry/api';

const SCOPE = '@themoltnet/pi-runtime/durable';
const contexts = new WeakMap<TelemetryContext, Context>();

function attributes(values: SpanAttributes = {}): Attributes {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  ) as Attributes;
}

/** Bridge Pi's native spans to the host's OTel providers; inert without an SDK. */
export function createPiTelemetry(
  options: {
    parentContext?: Context;
    tracer?: Tracer;
    meter?: Meter;
  } = {},
): TelemetryContext {
  const tracer = options.tracer ?? trace.getTracer(SCOPE);
  const meter = options.meter ?? metrics.getMeter(SCOPE);
  const parentOf = (value: TelemetryContext) =>
    contexts.get(value) ?? ROOT_CONTEXT;
  const linkOf = (link: SpanLink): Link[] => {
    const target = trace.getSpanContext(parentOf(link.context));
    return target && isSpanContextValid(target)
      ? [{ context: target, attributes: attributes(link.attributes) }]
      : [];
  };
  const propagationAdapter: TelemetryPropagation = {
    inject(value) {
      const carrier: Record<string, string> = {};
      propagation.inject(parentOf(value), carrier);
      // Persist trace identity only, never arbitrary application baggage.
      const traceCarrier = Object.fromEntries(
        Object.entries(carrier).filter(
          ([key]) => key === 'traceparent' || key === 'tracestate',
        ),
      );
      return Object.keys(traceCarrier).length ? traceCarrier : undefined;
    },
    extract(carrier) {
      const traceCarrier = {
        ...(carrier?.traceparent ? { traceparent: carrier.traceparent } : {}),
        ...(carrier?.tracestate ? { tracestate: carrier.tracestate } : {}),
      };
      return wrap(propagation.extract(ROOT_CONTEXT, traceCarrier));
    },
  };
  const metricAdapter: TelemetryMetrics = {
    counter(name, options) {
      const instrument = meter.createCounter(name, options);
      return {
        add: (value, attrs) => instrument.add(value, attributes(attrs)),
      };
    },
    upDownCounter(name, options) {
      const instrument = meter.createUpDownCounter(name, options);
      return {
        add: (value, attrs) => instrument.add(value, attributes(attrs)),
      };
    },
    histogram(name, options) {
      const instrument = meter.createHistogram(name, {
        description: options?.description,
        unit: options?.unit,
        advice: {
          explicitBucketBoundaries: options?.boundaries
            ? [...options.boundaries]
            : undefined,
        },
      });
      return {
        record: (value, attrs, exemplar) =>
          instrument.record(
            value,
            attributes(attrs),
            exemplar ? parentOf(exemplar) : ROOT_CONTEXT,
          ),
      };
    },
  };
  const inert: TelemetrySpan = {
    ...NOOP_TELEMETRY_CONTEXT,
    metrics: metricAdapter,
    propagation: propagationAdapter,
    startSpan: async (_options, callback) => callback(inert),
  };
  function wrap(
    parent: Context,
    span?: Span,
    state?: { settled: boolean; status?: SpanStatus },
  ): TelemetrySpan {
    const adapter: TelemetrySpan = {
      metrics: metricAdapter,
      propagation: propagationAdapter,
      async startSpan(options, callback) {
        if (state?.settled) return inert.startSpan(options, callback);
        const child = tracer.startSpan(
          options.name,
          {
            attributes: attributes(options.attributes),
            links: options.links?.flatMap(linkOf),
          },
          parent,
        );
        const childContext = trace.setSpan(parent, child);
        const childState: { settled: boolean; status?: SpanStatus } = {
          settled: false,
        };
        try {
          return await context.with(childContext, () =>
            callback(wrap(childContext, child, childState)),
          );
        } catch (error) {
          // Native status categories are useful; arbitrary exception text can
          // contain provider payloads and belongs in the sanitized diagnostics.
          childState.status ??= { status: 'error' };
          throw error;
        } finally {
          childState.settled = true;
          const status = childState.status;
          child.setStatus(
            status?.status === 'error'
              ? {
                  code: SpanStatusCode.ERROR,
                  message: status.error?.name ?? 'pi_error',
                }
              : { code: SpanStatusCode.OK },
          );
          child.end();
        }
      },
      addLink: (link) => {
        if (!state?.settled)
          for (const value of linkOf(link)) span?.addLink(value);
      },
      addEvent: (name, attrs) => {
        if (!state?.settled) span?.addEvent(name, attributes(attrs));
      },
      setAttributes: (attrs) => {
        if (!state?.settled) span?.setAttributes(attributes(attrs));
      },
      setStatus: (status) => {
        if (state && !state.settled) state.status = status;
      },
    };
    contexts.set(adapter, parent);
    return adapter;
  }
  return wrap(options.parentContext ?? context.active());
}
