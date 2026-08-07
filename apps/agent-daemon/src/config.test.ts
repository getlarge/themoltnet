import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig benchmark dimensions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts only bounded cell and virtualization labels', () => {
    vi.stubEnv('MOLTNET_CELL_TOPOLOGY', 'split');
    vi.stubEnv('MOLTNET_VIRTUALIZATION_MODE', 'kvm');

    expect(loadConfig()).toMatchObject({
      cellTopology: 'split',
      virtualizationMode: 'kvm',
    });
  });

  it('uses unclassified labels when dimensions are unset', () => {
    expect(loadConfig()).toMatchObject({
      cellTopology: 'unclassified',
      virtualizationMode: 'unclassified',
      traceIdlePolling: false,
    });
  });

  it('rejects unknown labels instead of silently merging cohorts', () => {
    vi.stubEnv('MOLTNET_CELL_TOPOLOGY', 'customer-123');
    vi.stubEnv('MOLTNET_VIRTUALIZATION_MODE', 'magic');

    expect(() => loadConfig()).toThrow('MOLTNET_CELL_TOPOLOGY must be one of');
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
