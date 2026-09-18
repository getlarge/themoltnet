import { describe, expect, it, vi } from 'vitest';

import { createToolPolicyDecisionSink } from './decision-sink.js';
import type { ToolPolicyDecisionRecord } from './session-policy.js';

const record = (): ToolPolicyDecisionRecord & { execution: string } => ({
  decision: 'blocked',
  tool_name: 'bash',
  reason_code: 'tool_not_permitted',
  enforcement: 'enforce',
  degraded: false,
  execution: 'parent',
});

describe('createToolPolicyDecisionSink', () => {
  it('records without waiting for the emission', () => {
    let settle: (() => void) | undefined;
    const emit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const sink = createToolPolicyDecisionSink(emit);

    // The gate's handler is synchronous: recording must return immediately
    // even though the write is still in flight.
    sink.record(record());
    expect(emit).toHaveBeenCalledTimes(1);
    expect(sink.size).toBe(1);

    settle?.();
  });

  it('drain resolves only after a slow emission settles', async () => {
    let settle: (() => void) | undefined;
    const sink = createToolPolicyDecisionSink(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    sink.record(record());

    let drained = false;
    const draining = sink.drain().then(() => {
      drained = true;
    });

    // Let the microtask queue run: without the pending emission being awaited,
    // `drain` would already have resolved here.
    await Promise.resolve();
    expect(drained).toBe(false);

    settle?.();
    await draining;
    expect(drained).toBe(true);
  });

  it('captures an emission recorded while draining', async () => {
    const order: string[] = [];
    let settleFirst: (() => void) | undefined;
    const sink = createToolPolicyDecisionSink(
      (r) =>
        new Promise<void>((resolve) => {
          order.push(r.tool_name);
          if (settleFirst === undefined) {
            settleFirst = resolve;
          } else {
            resolve();
          }
        }),
    );

    sink.record({ ...record(), tool_name: 'first' });
    const draining = sink.drain();
    sink.record({ ...record(), tool_name: 'second' });
    settleFirst?.();
    await draining;

    expect(order).toEqual(['first', 'second']);
    expect(sink.size).toBe(0);
  });

  it('a failing emission does not reject the drain', async () => {
    const sink = createToolPolicyDecisionSink(() =>
      Promise.reject(new Error('reporter down')),
    );
    sink.record(record());
    // The attempt's outcome must not depend on whether its audit trail wrote.
    await expect(sink.drain()).resolves.toBeUndefined();
  });

  it('a synchronously throwing emitter does not reach the caller', () => {
    const sink = createToolPolicyDecisionSink(() => {
      throw new Error('boom');
    });
    expect(() => sink.record(record())).not.toThrow();
  });
});
