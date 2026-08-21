import { ensureSnapshot } from '@themoltnet/pi-runtime';
import {
  createNodeConformanceHarness,
  runSandboxConformance,
} from '@themoltnet/runtime-core/conformance';
import { describe, expect, it } from 'vitest';

import { createGondolinSandboxAdapter } from './gondolin-sandbox-adapter.js';

/**
 * Live Gondolin conformance. Opt-in: it boots real microVMs from the local
 * checkpoint cache and needs the host to resolve `*.lvh.me` (public loopback
 * names) because guest `127.0.0.1`/`localhost` never leave the VM and the
 * host proxy resolves names on the host side.
 *
 *   MOLTNET_PI_VM_INTEGRATION=1 pnpm exec nx run @themoltnet/sandbox-gondolin:test \
 *     -- src/gondolin-sandbox-adapter.conformance.test.ts
 */
// Opt-in live test switch, same convention as pi-runtime's VM integration test.
/* eslint-disable no-restricted-syntax -- opt-in live test switch, same convention as pi-runtime's VM integration test */
const describeVm =
  process.env.MOLTNET_PI_VM_INTEGRATION === '1' ? describe : describe.skip;

describeVm('gondolin sandbox adapter conformance (live VM)', () => {
  it('passes the shared marker-oracle suite, reporting host-only fidelity honestly', async () => {
    const harness = createNodeConformanceHarness({
      loopback: {
        allowed: {
          guestHostname: 'allowed.lvh.me',
          destination: { host: 'allowed.lvh.me' },
          allowedInternalHosts: ['allowed.lvh.me'],
        },
        denied: { guestHostname: 'denied.lvh.me' },
      },
    });
    const adapter = createGondolinSandboxAdapter({
      checkpoint: () => ensureSnapshot(),
    });

    const summary = await runSandboxConformance({
      adapter,
      harness,
      onProgress: (message) =>
        process.stderr.write(`[conformance] ${message}\n`),
    });
    process.stderr.write(
      `${JSON.stringify(
        summary.results.map(({ id, status, state, details }) => ({
          id,
          status,
          state,
          details,
        })),
        null,
        2,
      )}\n`,
    );

    expect(summary.failed).toEqual([]);
    expect(summary.unsupported).toEqual([]);
    expect(summary.passed).toHaveLength(16);
    expect(summary.cleanup).toEqual({ cleaned: true, residue: [] });
    expect(summary.results.find((r) => r.id === 'C16')?.state).toBe('degraded');
    expect(JSON.stringify(summary)).not.toContain(harness.syntheticCredential);
  }, 600_000);
});
