import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BrokeredHttpSecretBoundaryError,
  type ManagedVm,
} from '@themoltnet/sandbox-gondolin';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadScenarioCatalog } from './catalog.js';
import {
  createFailClosedFixtureFetch,
  execGondolinGuest,
  GondolinAdapter,
} from './gondolin-adapter.js';
import type {
  ControlEvidence,
  ProbeContext,
  SandboxScenario,
} from './types.js';

function completedExec(exitCode = 0, output = '') {
  return Object.assign(Promise.resolve({ exitCode }), {
    output: async function* () {
      await Promise.resolve();
      yield {
        data: Buffer.from(output),
        stream: 'stdout' as const,
      };
    },
  });
}

describe('Gondolin research adapter guest transport', () => {
  it('routes only exact mapped origins and preserves path and query', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    const trustedFetch = createFailClosedFixtureFetch(
      new Map([['http://192.0.2.10:30001', 'http://127.0.0.1:41001']]),
      fetchImpl as never,
    );

    await trustedFetch('http://192.0.2.10:30001/path?q=1');

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:41001/path?q=1'),
      undefined,
    );
    await expect(trustedFetch('https://192.0.2.10:30001/path')).rejects.toThrow(
      'unmapped trusted fixture origin',
    );
    await expect(trustedFetch('http://192.0.2.10:30002/path')).rejects.toThrow(
      'unmapped trusted fixture origin',
    );
    await expect(trustedFetch('http://192.0.2.11:30001/path')).rejects.toThrow(
      'unmapped trusted fixture origin',
    );
  });

  it('preserves a successful managed result and guest output', async () => {
    const exec = vi.fn(() => completedExec(0, 'ok'));

    await expect(
      execGondolinGuest({ vm: { exec } } as never, 'printf ok'),
    ).resolves.toEqual({
      exitCode: 0,
      output: 'ok',
      termination: { status: 'not-required' },
    });
    expect(exec).toHaveBeenCalledWith(
      ['/bin/sh', '-lc', 'printf ok'],
      expect.any(Object),
    );
  });

  it('does not turn transport failure into a guest exit code', async () => {
    const transportError = new Error('VM transport disconnected');
    const exec = vi.fn(() => {
      throw transportError;
    });

    await expect(
      execGondolinGuest({ vm: { exec } } as never, 'false'),
    ).rejects.toBe(transportError);
  });
});

describe('Gondolin research adapter evidence', () => {
  const adapters: GondolinAdapter[] = [];
  const probeRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(adapters.splice(0).map((adapter) => adapter.close()));
    await Promise.all(
      probeRoots
        .splice(0)
        .map((probeRoot) => rm(probeRoot, { recursive: true, force: true })),
    );
  });

  it('deliberately maps every negative TEST-NET origin and fails closed otherwise', async () => {
    const context = await probeContext(probeRoots);
    const managed = fakeManaged();
    const resumeVm = vi.fn().mockResolvedValue(managed);
    const fixtureFetchImpl = vi.fn().mockResolvedValue(new Response('ok'));
    const adapter = fakeAdapter(context, { resumeVm, fixtureFetchImpl });
    adapters.push(adapter);
    await adapter.runScenario(await scenario('network.exact-allow'), context);
    const trustedFetch = resumeVm.mock.calls[0]?.[0]
      .trustedHttpFetch as typeof fixtureFetchImpl;

    for (const origin of [
      'http://192.0.2.11:30001',
      'http://192.0.2.10:30002',
      'https://192.0.2.10:30001',
      'http://198.51.100.10:30002',
      'http://127.0.0.1:30001',
    ]) {
      await expect(trustedFetch(`${origin}/negative`)).resolves.toBeInstanceOf(
        Response,
      );
    }
    await expect(
      trustedFetch('http://203.0.113.10:30001/unmapped'),
    ).rejects.toThrow('unmapped trusted fixture origin');
    expect(fixtureFetchImpl).toHaveBeenCalledTimes(5);
  });

  it('accepts only the expected missing-binding boundary error and closes an unexpected VM', async () => {
    const context = await probeContext(probeRoots);
    const managed = fakeManaged();
    const unexpected = fakeManaged();
    const resumeVm = vi
      .fn()
      .mockResolvedValueOnce(managed)
      .mockRejectedValueOnce(
        new BrokeredHttpSecretBoundaryError([
          'required binding "missing-fixture" has no resolved value',
        ]),
      );
    const adapter = fakeAdapter(context, { resumeVm });
    adapters.push(adapter);

    const evidence = await adapter.runScenario(
      await scenario('credential.missing-binding'),
      context,
    );

    expect(evidence).toMatchObject({ state: 'enforced' });
    await expect(
      adapter.runScenario(
        await scenario('lifecycle.broker-unavailable'),
        context,
      ),
    ).resolves.toMatchObject({
      state: 'unsupported',
      unsupportedKind: 'not-measured',
      reasonCode: 'broker_preflight_unverified',
    });
    expect(resumeVm).toHaveBeenCalledTimes(2);
    expect(resumeVm.mock.calls[1]?.[0]).toMatchObject({
      workspaceMode: 'scratch_mount',
      sandboxConfig: {
        network: {
          allowedInternalHosts: ['192.0.2.10', '198.51.100.10'],
        },
        resources: { cpus: 1, memory: '1G' },
      },
    });

    const arbitraryFailure = vi
      .fn()
      .mockResolvedValueOnce(managed)
      .mockRejectedValueOnce(new Error('transport disconnected'));
    const rejected = fakeAdapter(context, { resumeVm: arbitraryFailure });
    adapters.push(rejected);
    await expect(
      rejected.runScenario(
        await scenario('credential.missing-binding'),
        context,
      ),
    ).rejects.toThrow('transport disconnected');

    const launched = vi
      .fn()
      .mockResolvedValueOnce(managed)
      .mockResolvedValueOnce(unexpected);
    const failedOpen = fakeAdapter(context, { resumeVm: launched });
    adapters.push(failedOpen);
    await expect(
      failedOpen.runScenario(
        await scenario('credential.missing-binding'),
        context,
      ),
    ).resolves.toMatchObject({ state: 'failed-open' });
    expect(unexpected.vm.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['filesystem', 'filesystem.outside-write'],
    ['network', 'network.wrong-port'],
    ['credential', 'credential.allowed-origin'],
    ['lifecycle', 'lifecycle.cancel'],
  ] as const)(
    'makes the %s oracle independently pass and fail',
    async (_family, scenarioId) => {
      const passingContext = await probeContext(probeRoots);
      const passing = fakeAdapter(passingContext, {
        outcome: 'pass',
      });
      adapters.push(passing);
      if (scenarioId === 'network.wrong-port') {
        await passing.runScenario(
          await scenario('network.exact-allow'),
          passingContext,
        );
      }
      const passingEvidence = await passing.runScenario(
        await falsifiableScenario(scenarioId),
        passingContext,
      );

      const failingContext = await probeContext(probeRoots);
      const failing = fakeAdapter(failingContext, {
        outcome: 'fail',
      });
      adapters.push(failing);
      if (scenarioId === 'network.wrong-port') {
        await failing.runScenario(
          await scenario('network.exact-allow'),
          failingContext,
        );
      }
      const failingEvidence = await failing.runScenario(
        await falsifiableScenario(scenarioId),
        failingContext,
      );

      expect(probeResult(passingEvidence)).toEqual({
        state: 'enforced',
        passed: true,
      });
      expect(probeResult(failingEvidence)).toEqual({
        state: 'failed-open',
        passed: false,
      });
    },
  );

  it.each([
    'network.wrong-host',
    'network.wrong-port',
    'network.protocol',
    'network.redirect',
    'network.internal',
    'network.requested-effective',
    'credential.adjacent-origin',
    'credential.rotation',
    'credential.revocation',
    'credential.resume',
  ] as const)('keeps the updated %s oracle falsifiable', async (scenarioId) => {
    for (const outcome of ['pass', 'fail'] as const) {
      const context = await probeContext(probeRoots);
      const adapter = fakeAdapter(context, {
        outcome,
        failScenario: outcome === 'fail' ? scenarioId : undefined,
      });
      adapters.push(adapter);
      await primeScenario(adapter, scenarioId, context);

      const evidence = await adapter.runScenario(
        await scenario(scenarioId),
        context,
      );

      expect(probeResult(evidence)).toEqual({
        state: outcome === 'pass' ? 'enforced' : 'failed-open',
        passed: outcome === 'pass',
      });
    }
  });
});

async function primeScenario(
  adapter: GondolinAdapter,
  scenarioId: string,
  context: ProbeContext,
): Promise<void> {
  if (
    scenarioId.startsWith('network.') &&
    scenarioId !== 'network.requested-effective'
  ) {
    await adapter.runScenario(await scenario('network.exact-allow'), context);
  }
  if (scenarioId.startsWith('credential.')) {
    await adapter.runScenario(await scenario('network.exact-allow'), context);
    await adapter.runScenario(
      await scenario('credential.allowed-origin'),
      context,
    );
  }
  if (scenarioId === 'credential.revocation') {
    await adapter.runScenario(await scenario('credential.rotation'), context);
  }
}

function probeResult(evidence: ControlEvidence) {
  return { state: evidence.state, passed: evidence.oracle?.passed };
}

async function scenario(id: string): Promise<SandboxScenario> {
  const scenario = (await loadScenarioCatalog()).scenarios.find(
    (candidate) => candidate.id === id,
  );
  if (!scenario) throw new Error(`missing scenario ${id}`);
  return scenario;
}

async function falsifiableScenario(id: string): Promise<SandboxScenario> {
  const selected = await scenario(id);
  return id === 'lifecycle.cancel'
    ? {
        ...selected,
        parameters: {
          ...selected.parameters,
          delayedMarkerMs: 1,
          observationWindowMs: 1,
        },
      }
    : selected;
}

async function probeContext(probeRoots: string[]): Promise<ProbeContext> {
  const probeRoot = await mkdtemp(
    path.join(os.tmpdir(), 'gondolin-adapter-test-'),
  );
  probeRoots.push(probeRoot);
  return {
    runId: path.basename(probeRoot),
    recordedAt: () => '2026-08-25T00:00:00.000Z',
    probeRoot,
    deadline: '2026-08-25T00:01:00.000Z',
    signal: new AbortController().signal,
  };
}

function fakeManaged(): ManagedVm {
  return {
    vm: { close: vi.fn().mockResolvedValue(undefined) },
    credentials: {},
    secretManager: {
      rotateSecret: vi.fn(),
      revokeSecret: vi.fn(),
    },
    mountPath: '/workspace',
    guestWorkspace: '/workspace',
    agentDir: '/agent',
  } as never;
}

function fakeAdapter(
  context: ProbeContext,
  options: {
    outcome?: 'pass' | 'fail';
    failScenario?: string;
    fixtureFetchImpl?: ReturnType<typeof vi.fn>;
    resumeVm?: ReturnType<typeof vi.fn>;
  } = {},
): GondolinAdapter {
  const outcome = options.outcome ?? 'pass';
  const fails = (scenarioId: string): boolean =>
    outcome === 'fail' &&
    (options.failScenario === undefined || options.failScenario === scenarioId);
  const managed = fakeManaged();
  const requests: Array<{
    destination: 'allowed' | 'adjacent';
    method: string;
    path: string;
    credentialMatch: 'expected' | 'absent' | 'unexpected';
  }> = [];
  let allowedConnections = 0;
  let adjacentConnections = 0;
  const fixture = {
    allowedPort: 30_001,
    adjacentPort: 30_002,
    credential: 'synthetic-test-credential',
    requests,
    capture: (start: number) => requests.slice(start),
    connectionCount: (destination: 'allowed' | 'adjacent') =>
      destination === 'adjacent' ? adjacentConnections : allowedConnections,
    path: (pathname: string) => `/fixture${pathname}`,
    rotate: () => 'synthetic-test-credential-rotated',
    restore: vi.fn(),
    sensitiveValues: () => ['synthetic-test-credential'],
    close: vi.fn().mockResolvedValue(undefined),
  };
  const execute = vi.fn(async (_vm, command: string) => {
    if (command.includes('filesystem.outside-write')) {
      throw new Error('unexpected command shape');
    }
    if (command.includes("printf escaped > '") && outcome === 'fail') {
      const marker = /printf escaped > '([^']+)'/.exec(command)?.[1];
      if (marker) await writeFile(marker, 'escaped');
    }
    if (command.includes('/wrong-port') && fails('network.wrong-port')) {
      adjacentConnections += 1;
      requests.push({
        destination: 'adjacent',
        method: 'GET',
        path: '/wrong-port',
        credentialMatch: 'absent',
      });
    }
    if (command.includes('/wrong-host') && fails('network.wrong-host')) {
      allowedConnections += 1;
      requests.push({
        destination: 'allowed',
        method: 'GET',
        path: '/wrong-host',
        credentialMatch: 'absent',
      });
    }
    if (command.includes('/wrong-protocol') && fails('network.protocol')) {
      allowedConnections += 1;
      requests.push({
        destination: 'allowed',
        method: 'GET',
        path: '/wrong-protocol',
        credentialMatch: 'absent',
      });
    }
    if (command.includes('/redirect')) {
      requests.push({
        destination: 'allowed',
        method: 'GET',
        path: '/redirect',
        credentialMatch: 'expected',
      });
      if (fails('network.redirect')) {
        adjacentConnections += 1;
        requests.push({
          destination: 'adjacent',
          method: 'GET',
          path: '/redirect-target',
          credentialMatch: 'expected',
        });
      }
      return managedResult(fails('network.redirect') ? 0 : 1);
    }
    if (command.includes('/direct-loopback') && fails('network.internal')) {
      allowedConnections += 1;
      requests.push({
        destination: 'allowed',
        method: 'GET',
        path: '/direct-loopback',
        credentialMatch: 'absent',
      });
    }
    if (command.includes('/allowed')) {
      requests.push({
        destination: 'allowed',
        method: 'GET',
        path: '/allowed',
        credentialMatch: 'absent',
      });
      return managedResult(0);
    }
    if (command.includes('/adjacent-network')) {
      requests.push({
        destination: 'adjacent',
        method: 'GET',
        path: '/adjacent-network',
        credentialMatch: 'absent',
      });
      return managedResult(0);
    }
    if (command.includes('/adjacent-credential')) {
      if (fails('credential.adjacent-origin')) {
        requests.push({
          destination: 'adjacent',
          method: 'GET',
          path: '/adjacent-credential',
          credentialMatch: 'expected',
        });
        return managedResult(0);
      }
      return managedResult(1);
    }
    if (command.includes('/credential')) {
      requests.push({
        destination: 'allowed',
        method: 'GET',
        path: '/credential',
        credentialMatch: fails('credential.allowed-origin')
          ? 'unexpected'
          : 'expected',
      });
      return managedResult(0);
    }
    if (command.includes('/rotated') || command.includes('/resumed')) {
      requests.push({
        destination: 'allowed',
        method: 'GET',
        path: command.includes('/rotated') ? '/rotated' : '/resumed',
        credentialMatch: fails(
          command.includes('/rotated')
            ? 'credential.rotation'
            : 'credential.resume',
        )
          ? 'unexpected'
          : 'expected',
      });
      return managedResult(0);
    }
    if (command.includes('/revoked')) {
      requests.push({
        destination: 'allowed',
        method: 'GET',
        path: '/revoked',
        credentialMatch: fails('credential.revocation')
          ? 'expected'
          : 'unexpected',
      });
      return managedResult(fails('credential.revocation') ? 0 : 1);
    }
    if (command.includes('lifecycle.cancel.started')) {
      await writeFile(
        path.join(context.probeRoot, 'workspace', 'lifecycle.cancel.started'),
        'started',
      );
      if (outcome === 'fail') {
        await writeFile(
          path.join(context.probeRoot, 'workspace', 'lifecycle.cancel.txt'),
          'escaped',
        );
      }
      return {
        exitCode: 130,
        timedOut: false,
        cancelled: true,
        termination: { status: 'backend-retired', mode: 'vm-close' },
      };
    }
    const passed = outcome === 'pass';
    return managedResult(passed ? 1 : 0);
  });

  const defaultResume = vi.fn(async (resumeOptions) => {
    resumeOptions.onDiagnostic?.({
      event: 'vm.network.policy_bound',
      level: 'info',
      message: 'policy',
      hostnamePolicy: {
        allowedHosts: ['api.themolt.net'],
        allowedInternalHosts: !fails('network.requested-effective')
          ? ['192.0.2.10', '198.51.100.10']
          : ['192.0.2.10', '198.51.100.10', '192.0.2.11'],
      },
    });
    return managed;
  });

  return new GondolinAdapter({
    ensureSnapshot: vi.fn().mockResolvedValue('/checkpoint') as never,
    execManagedCommand: execute as never,
    fixtureFetchImpl: (options.fixtureFetchImpl ?? vi.fn()) as never,
    resumeVm: (options.resumeVm ?? defaultResume) as never,
    startPolicyFixture: vi.fn().mockResolvedValue(fixture) as never,
  });
}

function managedResult(exitCode: number) {
  return {
    exitCode,
    timedOut: false,
    cancelled: false,
    termination: { status: 'not-required' as const },
  };
}
