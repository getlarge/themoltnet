import { describe, expect, it } from 'vitest';

import { loadScenarioCatalog, parseScenarioCatalog } from './catalog.js';

describe('sandbox policy scenario catalog', () => {
  it('loads the complete provider-neutral issue 1972 catalog', async () => {
    const catalog = await loadScenarioCatalog();

    expect(catalog.catalogVersion).toBe('issue-1972-v1');
    expect(catalog.scenarios.length).toBeGreaterThanOrEqual(30);
    expect(new Set(catalog.scenarios.map(({ id }) => id)).size).toBe(
      catalog.scenarios.length,
    );
    expect(new Set(catalog.scenarios.map(({ domain }) => domain))).toEqual(
      new Set([
        'filesystem',
        'network',
        'credential',
        'lifecycle',
        'resource',
        'topology',
      ]),
    );
  });

  it('rejects duplicate scenario ids', () => {
    expect(() =>
      parseScenarioCatalog({
        schemaVersion: 1,
        catalogVersion: 'test',
        notice: 'private test',
        scenarios: [
          {
            id: 'network.same',
            domain: 'network',
            control: 'one',
            purpose: 'one',
            required: true,
            oracle: 'one',
          },
          {
            id: 'network.same',
            domain: 'network',
            control: 'two',
            purpose: 'two',
            required: true,
            oracle: 'two',
          },
        ],
      }),
    ).toThrow('duplicate scenario id');
  });
});
