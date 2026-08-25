import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BrokeredHttpSecretBoundaryError,
  type ManagedVm,
} from '@themoltnet/sandbox-gondolin';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadScenarioCatalog } from './catalog.js';
import { execGondolinGuest, GondolinAdapter } from './gondolin-adapter.js';
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
    expect(resumeVm.mock.calls[1]?.[0]).toMatchObject({
      workspaceMode: 'scratch_mount',
      sandboxConfig: {
        network: { allowedInternalHosts: ['127.0.0.1'] },
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
});

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
    resumeVm?: ReturnType<typeof vi.fn>;
  } = {},
): GondolinAdapter {
  const outcome = options.outcome ?? 'pass';
  const managed = fakeManaged();
  const requests: Array<{
    destination: 'allowed' | 'adjacent';
    method: string;
    path: string;
    credentialMatch: 'expected' | 'absent' | 'unexpected';
  }> = [];
  let adjacentConnections = 0;
  const fixture = {
    allowedPort: 30_001,
    adjacentPort: 30_002,
    credential: 'synthetic-test-credential',
    requests,
    capture: (start: number) => requests.slice(start),
    connectionCount: (destination: 'allowed' | 'adjacent') =>
      destination === 'adjacent' ? adjacentConnections : 0,
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
    if (command.includes('/wrong-port') && outcome === 'fail') {
      adjacentConnections += 1;
      requests.push({
        destination: 'adjacent',
        method: 'GET',
        path: '/wrong-port',
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
      return {
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        termination: { status: 'not-required' },
      };
    }
    if (command.includes('/credential')) {
      requests.push({
        destination: 'allowed',
        method: 'GET',
        path: '/credential',
        credentialMatch: outcome === 'pass' ? 'expected' : 'unexpected',
      });
      return {
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        termination: { status: 'not-required' },
      };
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
    return {
      exitCode: passed ? 1 : 0,
      timedOut: false,
      cancelled: false,
      termination: { status: 'not-required' },
    };
  });

  return new GondolinAdapter({
    ensureSnapshot: vi.fn().mockResolvedValue('/checkpoint') as never,
    execManagedCommand: execute as never,
    resumeVm: (options.resumeVm ?? vi.fn().mockResolvedValue(managed)) as never,
    startPolicyFixture: vi.fn().mockResolvedValue(fixture) as never,
  });
}
