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

  it('maps unknown labels to unclassified', () => {
    vi.stubEnv('MOLTNET_CELL_TOPOLOGY', 'customer-123');
    vi.stubEnv('MOLTNET_VIRTUALIZATION_MODE', 'magic');

    expect(loadConfig()).toMatchObject({
      cellTopology: 'unclassified',
      virtualizationMode: 'unclassified',
    });
  });
});
