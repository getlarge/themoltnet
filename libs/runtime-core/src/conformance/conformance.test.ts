import { describe, expect, it } from 'vitest';

import { SANDBOX_CONFORMANCE_CASES } from './cases.js';
import { createNodeConformanceHarness } from './harness.js';
import { parseRecipe, renderRecipe } from './recipes.js';
import { createReferenceSandboxAdapter } from './reference-adapter.js';
import { runSandboxConformance } from './runner.js';

const loopback = {
  allowed: {
    guestHostname: '127.0.0.1',
    destination: { host: '127.0.0.1', port: 'fixture' as const },
    allowedInternalHosts: ['127.0.0.1'],
  },
  denied: { guestHostname: '127.0.0.1' },
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

  it('nests child shells for containment and delayed writes', () => {
    expect(
      renderRecipe({
        op: 'write-file-via-child',
        path: '/ws/protected/m',
        content: 'c',
        depth: 2,
      }).match(/sh -c/g),
    ).toHaveLength(2);
    const delayed = renderRecipe({
      op: 'delayed-write',
      path: '/ws/late',
      content: 'l',
      delaySeconds: 3,
      viaChild: true,
    });
    expect(delayed).toContain('sleep 3 &&');
    expect(delayed).toContain('sh -c');
  });

  it('pins a hostname with curl --resolve when asked', () => {
    expect(
      renderRecipe({
        op: 'http-get',
        url: 'http://a.test:8080/x',
        resolveTo: '10.0.0.1',
      }),
    ).toContain("--resolve 'a.test:8080:10.0.0.1'");
  });
});

describe('sandbox conformance suite against the reference adapter', () => {
  it('passes every marker-oracle case when all capabilities are simulated at host-port fidelity', async () => {
    const harness = createNodeConformanceHarness({ loopback });
    const adapter = createReferenceSandboxAdapter();

    const summary = await runSandboxConformance({ adapter, harness });

    expect(summary.results.map((r) => r.id)).toEqual(
      SANDBOX_CONFORMANCE_CASES.map((c) => c.id),
    );
    expect(summary.failed).toEqual([]);
    expect(summary.unsupported).toEqual([]);
    expect(summary.passed).toHaveLength(16);
    expect(summary.cleanup).toEqual({ cleaned: true, residue: [] });
    const byId = Object.fromEntries(summary.results.map((r) => [r.id, r]));
    expect(byId['C01'].state).toBe('failed');
    expect(byId['C11'].state).toBe('failed');
    expect(byId['C14'].state).toBe('unsupported');
    expect(['failed', 'degraded']).toContain(byId['C15'].state);
    expect(byId['C16'].state).toBe('enforced');
    expect(JSON.stringify(summary)).not.toContain(harness.syntheticCredential);
  }, 60_000);

  it('reports host-only fidelity honestly in C16 and still passes the rest', async () => {
    const harness = createNodeConformanceHarness({
      loopback: {
        allowed: {
          guestHostname: 'localhost',
          destination: { host: 'localhost' },
          allowedInternalHosts: ['localhost'],
        },
        denied: { guestHostname: '127.0.0.1' },
      },
    });
    const adapter = createReferenceSandboxAdapter({ fidelity: 'host' });
    const summary = await runSandboxConformance({ adapter, harness });
    expect(summary.failed).toEqual([]);
    const c16 = summary.results.find((r) => r.id === 'C16');
    expect(c16).toMatchObject({ status: 'passed', state: 'degraded' });
  }, 60_000);

  it('reports unsupported, not passed, when the adapter declares a capability unsupported', async () => {
    const harness = createNodeConformanceHarness({ loopback });
    const adapter = createReferenceSandboxAdapter({
      unsupported: ['brokered-credential', 'timeout-cancellation'],
    });

    const summary = await runSandboxConformance({ adapter, harness });

    expect(summary.failed).toEqual([]);
    expect(summary.unsupported.sort()).toEqual(['C07', 'C08', 'C12', 'C13']);
    expect(summary.results.find((r) => r.id === 'C12')?.state).toBe(
      'unsupported',
    );
  }, 60_000);

  it('marks cases failed when the adapter misbehaves or leaves residue', async () => {
    const harness = createNodeConformanceHarness({ loopback });
    const base = createReferenceSandboxAdapter();
    const leaky = {
      ...base,
      async launch(plan: Parameters<typeof base.launch>[0]) {
        const handle = await base.launch({
          ...plan,
          filesystem: { ...plan.filesystem, denyPaths: [] },
        });
        return {
          ...handle,
          exec: handle.exec.bind(handle),
          observe: handle.observe.bind(handle),
          close: async () => ({
            cleaned: false,
            residue: ['left a container running'],
          }),
        };
      },
    };

    const summary = await runSandboxConformance({
      adapter: leaky,
      harness,
      only: ['C03', 'C06'],
    });

    expect(summary.failed.sort()).toEqual(['C03', 'C06']);
    expect(summary.cleanup).toEqual({
      cleaned: false,
      residue: ['left a container running'],
    });
  }, 60_000);
});
