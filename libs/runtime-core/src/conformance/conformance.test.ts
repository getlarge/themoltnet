import { describe, expect, it } from 'vitest';

import { SANDBOX_CONFORMANCE_CASES } from './cases.js';
import { createNodeConformanceHarness } from './harness.js';
import { parseRecipe, renderRecipe } from './recipes.js';
import { createReferenceSandboxAdapter } from './reference-adapter.js';
import { runSandboxConformance } from './runner.js';

const loopback = {
  allowed: {
    guestHostname: '127.0.0.1',
    allowedHosts: ['127.0.0.1'],
    allowedInternalHosts: ['127.0.0.1'],
  },
  denied: { guestHostname: 'localhost' },
};

describe('conformance recipes', () => {
  it('round-trips the structured header and renders POSIX sh', () => {
    const recipe = {
      op: 'write-file' as const,
      path: "/ws/it's/marker.txt",
      content: 'x',
    };
    const rendered = renderRecipe(recipe);
    expect(parseRecipe(rendered)).toEqual(recipe);
    expect(rendered).toContain(`printf '%s' 'x' > '/ws/it'\\''s/marker.txt'`);
    expect(parseRecipe('echo plain')).toBeUndefined();
  });

  it('nests child shells for containment cases', () => {
    const rendered = renderRecipe({
      op: 'write-file-via-child',
      path: '/ws/protected/m',
      content: 'c',
      depth: 2,
    });
    expect(rendered.match(/sh -c/g)).toHaveLength(2);
  });
});

describe('sandbox conformance suite against the reference adapter', () => {
  it('passes every marker-oracle case when all capabilities are simulated', async () => {
    // Arrange
    const harness = createNodeConformanceHarness({ loopback });
    const adapter = createReferenceSandboxAdapter();

    // Act
    const summary = await runSandboxConformance({ adapter, harness });

    // Assert
    expect(summary.results.map((r) => r.id)).toEqual(
      SANDBOX_CONFORMANCE_CASES.map((c) => c.id),
    );
    expect(summary.failed).toEqual([]);
    expect(summary.unsupported).toEqual([]);
    expect(summary.passed).toHaveLength(15);
    const byId = Object.fromEntries(summary.results.map((r) => [r.id, r]));
    expect(byId['C01'].state).toBe('failed');
    expect(byId['C11'].state).toBe('failed');
    expect(byId['C14'].state).toBe('unsupported');
    expect(['failed', 'degraded']).toContain(byId['C15'].state);
    expect(JSON.stringify(summary)).not.toContain(harness.syntheticCredential);
  }, 30_000);

  it('reports unsupported, not passed, when the adapter declares a capability unsupported', async () => {
    // Arrange
    const harness = createNodeConformanceHarness({ loopback });
    const adapter = createReferenceSandboxAdapter({
      unsupported: ['brokered-credential', 'timeout-cancellation'],
    });

    // Act
    const summary = await runSandboxConformance({ adapter, harness });

    // Assert
    expect(summary.failed).toEqual([]);
    expect(summary.unsupported.sort()).toEqual(['C07', 'C08', 'C12', 'C13']);
    expect(summary.passed).not.toContain('C12');
    const c12 = summary.results.find((r) => r.id === 'C12');
    expect(c12?.state).toBe('unsupported');
  }, 30_000);

  it('marks a case failed when the adapter misbehaves', async () => {
    // Arrange: an adapter that lets denied writes through.
    const harness = createNodeConformanceHarness({ loopback });
    const base = createReferenceSandboxAdapter();
    const leaky = {
      ...base,
      async launch(plan: Parameters<typeof base.launch>[0]) {
        return base.launch({
          ...plan,
          filesystem: { ...plan.filesystem, denyPaths: [] },
        });
      },
    };

    // Act
    const summary = await runSandboxConformance({
      adapter: leaky,
      harness,
      only: ['C03', 'C06'],
    });

    // Assert
    expect(summary.failed.sort()).toEqual(['C03', 'C06']);
  }, 30_000);
});
