import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { DestinationConstraint } from '../intent.js';

/**
 * Independent host-side oracle for one loopback destination. It records how
 * many requests arrived and whether the expected credential value arrived.
 * It never logs headers or the value.
 */
export interface LoopbackFixture {
  readonly port: number;
  readonly hits: number;
  /** True when at least one request carried `Authorization: Bearer <expected>`. */
  readonly sawExpectedCredential: boolean;
  /** True when a request carried an Authorization header whose value was not the expected one (e.g. the stand-in). */
  readonly sawOtherCredential: boolean;
  close(): Promise<void>;
}

export interface ConformanceWorkspace {
  readonly hostPath: string;
  exists(relativePath: string): boolean;
  read(relativePath: string): string | undefined;
  cleanup(): void;
}

/**
 * How the guest reaches host loopback fixtures and how the plan must name
 * them. Gondolin resolves `127.0.0.1` through `allowedInternalHosts` and
 * matches hostnames only (no port); Docker Sandbox rewrites
 * `host.docker.internal` and matches `localhost:<port>`. Both stay
 * adapter-test configuration; the suite only needs one allowed and one
 * adjacent denied destination that share a host process boundary.
 */
export interface LoopbackDestination {
  /** Hostname the guest uses to reach this destination. */
  guestHostname: string;
  /**
   * Guest-visible address the hostname is pinned to when the guest cannot
   * resolve it (e.g. a gateway that maps to host loopback).
   */
  resolveTo?: string;
  /**
   * Destination constraint the intent lists for this fixture. The fixture
   * port is only known at runtime, so `port: 'fixture'` is substituted.
   */
  destination: Omit<DestinationConstraint, 'port'> & {
    port?: number | 'fixture';
  };
  /** Host patterns allowed to resolve to internal ranges (allowedInternalHosts). */
  allowedInternalHosts: readonly string[];
}

export interface LoopbackBinding {
  allowed: LoopbackDestination;
  /** Adjacent destination that must receive zero requests. Only `guestHostname` is used. */
  denied: Pick<LoopbackDestination, 'guestHostname' | 'resolveTo'>;
}

export interface ConformanceHarness {
  createWorkspace(): ConformanceWorkspace;
  startLoopbackFixture(expectedCredential?: string): Promise<LoopbackFixture>;
  loopback: LoopbackBinding;
  /** Synthetic credential value for this run. Never a real secret. */
  syntheticCredential: string;
  /** Host environment name set during the run; the guest must not see it. */
  hostSentinelEnvName: string;
}

export interface NodeHarnessOptions {
  loopback: LoopbackBinding;
  tmpRoot?: string;
}

export function createNodeConformanceHarness(
  options: NodeHarnessOptions,
): ConformanceHarness {
  const syntheticCredential = `moltnet-conformance-${randomBytes(12).toString('hex')}`;
  const hostSentinelEnvName = 'MOLTNET_CONFORMANCE_HOST_SENTINEL';
  // Test harness: plant a sentinel in the host process environment so the
  // suite can prove the guest does not inherit it. Not application config.
  // eslint-disable-next-line no-restricted-syntax
  process.env[hostSentinelEnvName] =
    `sentinel-${randomBytes(6).toString('hex')}`;
  return {
    loopback: options.loopback,
    syntheticCredential,
    hostSentinelEnvName,
    createWorkspace() {
      const hostPath = mkdtempSync(
        path.join(options.tmpRoot ?? tmpdir(), 'moltnet-conformance-'),
      );
      return {
        hostPath,
        exists: (rel) => existsSync(path.join(hostPath, rel)),
        read: (rel) =>
          existsSync(path.join(hostPath, rel))
            ? readFileSync(path.join(hostPath, rel), 'utf8')
            : undefined,
        cleanup: () => rmSync(hostPath, { recursive: true, force: true }),
      };
    },
    async startLoopbackFixture(expectedCredential) {
      let hits = 0;
      let sawExpectedCredential = false;
      let sawOtherCredential = false;
      const server: Server = createServer((req, res) => {
        hits += 1;
        const auth = req.headers.authorization;
        if (auth !== undefined) {
          if (
            expectedCredential !== undefined &&
            auth === `Bearer ${expectedCredential}`
          ) {
            sawExpectedCredential = true;
          } else {
            sawOtherCredential = true;
          }
        }
        res.statusCode = 200;
        res.end('ok');
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      return {
        port,
        get hits() {
          return hits;
        },
        get sawExpectedCredential() {
          return sawExpectedCredential;
        },
        get sawOtherCredential() {
          return sawOtherCredential;
        },
        close: () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections?.();
            server.close(() => resolve());
          }),
      };
    },
  };
}
