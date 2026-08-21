import {
  createNodeConformanceHarness,
  runSandboxConformance,
} from '@themoltnet/runtime-core';
import { describe, expect, it } from 'vitest';

import { ensureSnapshot } from '../snapshot.js';
import { createGondolinSandboxAdapter } from './gondolin-sandbox-adapter.js';

/**
 * Live Gondolin conformance. Opt-in: it boots real microVMs from the local
 * checkpoint cache. Run with:
 *
 *   MOLTNET_PI_VM_INTEGRATION=1 pnpm exec nx run @themoltnet/pi-runtime:test \
 *     -- src/sandbox/gondolin-sandbox-adapter.conformance.test.ts
 */
const describeVm =
  process.env.MOLTNET_PI_VM_INTEGRATION === '1' ? describe : describe.skip;

describeVm('gondolin sandbox adapter conformance (live VM)', () => {
  it('passes the shared marker-oracle suite', async () => {
    // Arrange. The guest's own `127.0.0.1`/`localhost` never leave the VM,
    // and Gondolin's host proxy resolves names on the host side, so both
    // fixtures are reached through public loopback names (`*.lvh.me` resolves
    // to 127.0.0.1). They differ by name because Gondolin's egress policy is
    // hostname-granular (no port). The host must be able to resolve lvh.me.
    const harness = createNodeConformanceHarness({
      loopback: {
        allowed: {
          guestHostname: 'allowed.lvh.me',
          allowedHosts: ['allowed.lvh.me'],
          allowedInternalHosts: ['allowed.lvh.me'],
        },
        denied: { guestHostname: 'denied.lvh.me' },
      },
    });
    const adapter = createGondolinSandboxAdapter({
      checkpoint: () => ensureSnapshot(),
    });

    // Act
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

    // Assert
    expect(summary.failed).toEqual([]);
    expect(summary.unsupported).toEqual([]);
    expect(summary.passed).toHaveLength(15);
    expect(JSON.stringify(summary)).not.toContain(harness.syntheticCredential);
  }, 600_000);
});
