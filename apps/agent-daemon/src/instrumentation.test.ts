/**
 * Guards the daemon's instrumentation config. The behavioral guarantees
 * (traceparent injection, pino wiring) live in @moltnet/observability's own
 * test; here we only assert the daemon enables the right set: undici/pino must
 * stay on (they are the distributed-tracing + log-correlation feature), and pg
 * stays off (the daemon has no direct DB).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const initInstrumentation = vi.fn();

vi.mock('@moltnet/observability/instrumentation', () => ({
  initInstrumentation,
}));

describe('daemon instrumentation bootstrap', () => {
  afterEach(() => {
    vi.resetModules();
    initInstrumentation.mockClear();
  });

  it('enables http/dns/net/pino and disables pg on import', async () => {
    // The module calls initInstrumentation as an import-time side effect.
    await import('./instrumentation.js');

    expect(initInstrumentation).toHaveBeenCalledTimes(1);
    expect(initInstrumentation).toHaveBeenCalledWith({
      http: true,
      dns: true,
      net: true,
      pino: true,
      pg: false,
    });
  });
});
