import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig observability settings', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps full idle polling traces disabled by default', () => {
    expect(loadConfig().traceIdlePolling).toBe(false);
  });

  it('enables full idle polling traces only with an explicit boolean', () => {
    vi.stubEnv('MOLTNET_TRACE_IDLE_POLLING', 'true');
    expect(loadConfig().traceIdlePolling).toBe(true);

    vi.stubEnv('MOLTNET_TRACE_IDLE_POLLING', 'yes');
    expect(() => loadConfig()).toThrow(
      'MOLTNET_TRACE_IDLE_POLLING must be either true or false',
    );
  });
});
