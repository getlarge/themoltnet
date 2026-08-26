import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadScenarioCatalog } from './catalog.js';
import type { CommandExecutor, CommandResult } from './command.js';
import { DockerSandboxAdapter } from './docker-sandbox-adapter.js';
import type { ProbeContext, SandboxScenario } from './types.js';

class HostScopedCredentialProxy {
  readonly commands: string[][] = [];
  credential: string | undefined;
  failSecretRemoval = false;
  acknowledgeDetached = false;
  stoppedSandbox: string | undefined;
  readonly sandboxNames = new Set<string>();
  reportStoppedSandboxAsRunning = false;

  readonly execute: CommandExecutor = async (_command, args) => {
    this.commands.push(args);
    if (args[0] === 'version') {
      return { exitCode: 0, stdout: 'sbx version: v0.39.0', stderr: '' };
    }
    if (args[0] === 'secret' && args[1] === 'set-custom') {
      const commandIndex = args.indexOf('--command');
      const secretPath = /^cat '([^']+)'$/.exec(
        args[commandIndex + 1] ?? '',
      )?.[1];
      this.credential = secretPath
        ? (await readFile(secretPath, 'utf8')).trim()
        : undefined;
      return success();
    }
    if (args[0] === 'secret' && args[1] === 'rm') {
      if (this.failSecretRemoval) {
        return { exitCode: 2, stdout: '', stderr: 'removal failed' };
      }
      this.credential = undefined;
      return success();
    }
    if (args[0] === 'create') {
      const nameIndex = args.indexOf('--name');
      const name = nameIndex >= 0 ? args[nameIndex + 1] : undefined;
      if (name) this.sandboxNames.add(name);
      return success();
    }
    if (args[0] === 'stop') {
      this.stoppedSandbox = args[1];
      return success();
    }
    if (args[0] === 'rm') {
      const name = args.at(-1);
      if (!name || !this.sandboxNames.delete(name)) {
        return { exitCode: 1, stdout: '', stderr: 'sandbox not found' };
      }
      if (this.stoppedSandbox === name) this.stoppedSandbox = undefined;
      return success();
    }
    if (args[0] === 'ls' && args[1] === '--json') {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          sandboxes: [...this.sandboxNames].map((name) => ({
            name,
            status:
              name === this.stoppedSandbox &&
              !this.reportStoppedSandboxAsRunning
                ? 'stopped'
                : 'running',
          })),
        }),
        stderr: '',
      };
    }
    if (args[0] === 'exec') {
      if (args.at(-1) === '/moltnet-deliberately-missing-executable') {
        return { exitCode: 127, stdout: '', stderr: 'executable not found' };
      }
      const shellCommand = args.at(-1) ?? '';
      if (args.includes('--detach') && this.acknowledgeDetached) {
        const started = /printf started > '([^']+)'/.exec(shellCommand)?.[1];
        if (started) await writeFile(started, 'started');
        return success();
      }
      const target = /http:\/\/[^'" ]+/.exec(shellCommand)?.[0];
      if (target) return requestFixture(target, this.credential);
    }
    return success();
  };
}

function success(): CommandResult {
  return { exitCode: 0, stdout: '', stderr: '' };
}

function requestFixture(
  target: string,
  credential: string | undefined,
): Promise<CommandResult> {
  const url = new URL(target);
  return new Promise((resolve, reject) => {
    const fixtureRequest = request(
      {
        host: '127.0.0.1',
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers: credential
          ? { authorization: `Bearer ${credential}` }
          : undefined,
      },
      (response) => {
        response.resume();
        response.once('end', () =>
          resolve({
            exitCode: response.statusCode && response.statusCode < 400 ? 0 : 22,
            stdout: '',
            stderr: '',
          }),
        );
      },
    );
    fixtureRequest.once('error', reject);
    fixtureRequest.end();
  });
}

describe('Docker sandbox research adapter', () => {
  const adapters: DockerSandboxAdapter[] = [];
  const probeRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(adapters.splice(0).map((adapter) => adapter.close()));
    await Promise.all(
      probeRoots
        .splice(0)
        .map((probeRoot) => rm(probeRoot, { recursive: true, force: true })),
    );
  });

  it('exercises the native host-scoped secret on an allowed adjacent port', async () => {
    const proxy = new HostScopedCredentialProxy();
    const adapter = new DockerSandboxAdapter({ execute: proxy.execute });
    adapters.push(adapter);
    const context = await probeContext(probeRoots);

    const allowed = await adapter.runScenario(
      await scenario('credential.allowed-origin'),
      context,
    );
    const adjacent = await adapter.runScenario(
      await scenario('credential.adjacent-origin'),
      context,
    );

    expect(allowed).toMatchObject({
      state: 'enforced',
      oracle: { attestedBy: 'harness', observed: 1, passed: true },
    });
    expect(adjacent).toMatchObject({
      state: 'failed-open',
      reasonCode: 'adjacent_origin_secret_not_substituted',
      oracle: { observed: 1, passed: false },
    });
    expect(
      proxy.commands.find(
        (args) => args[0] === 'create' && args.includes('--env'),
      ),
    ).toContain('MOLTNET_PROBE_TOKEN=moltnet-probe-placeholder');
    expect(
      proxy.commands.find(
        (args) =>
          args[0] === 'policy' &&
          /^127\.0\.0\.1:[0-9]+$/.test(args.at(-1) ?? ''),
      ),
    ).toBeDefined();
    expect(proxy.commands.flat()).not.toContain(proxy.credential);
    expect(
      proxy.commands.find(
        (args) =>
          args[0] === 'secret' &&
          args[1] === 'set-custom' &&
          args.includes('--command'),
      ),
    ).toBeDefined();
  });

  it('does not promote declared topology to verified enforcement', async () => {
    const proxy = new HostScopedCredentialProxy();
    const adapter = new DockerSandboxAdapter({ execute: proxy.execute });
    adapters.push(adapter);
    const evidence = await adapter.runScenario(
      await scenario('topology.host-capabilities'),
      await probeContext(probeRoots),
    );

    expect(evidence).toMatchObject({
      state: 'unsupported',
      basis: 'declared',
      oracle: null,
      reasonCode: 'capability_boundary_recorded',
      resolvedAdapterConfig: { fidelity: 'docker-sandbox-v0.39.0' },
    });
  });

  it('does not treat an unexercised redirect target as enforced', async () => {
    const proxy = new HostScopedCredentialProxy();
    const adapter = new DockerSandboxAdapter({ execute: proxy.execute });
    adapters.push(adapter);
    const evidence = await adapter.runScenario(
      await scenario('network.redirect'),
      await probeContext(probeRoots),
    );

    expect(evidence).toMatchObject({
      state: 'failed-open',
      oracle: {
        observed: {
          allowedRequests: 1,
          adjacentRequests: 0,
          guestExitCode: 0,
        },
        passed: false,
      },
    });
  });

  it('rejects an unacknowledged detached child and registers its cleanup', async () => {
    const proxy = new HostScopedCredentialProxy();
    const adapter = new DockerSandboxAdapter({ execute: proxy.execute });
    adapters.push(adapter);

    await expect(
      adapter.runScenario(
        await scenario('lifecycle.cancel'),
        await probeContext(probeRoots),
      ),
    ).rejects.toThrow('did not acknowledge startup');

    await adapter.close();
    expect(
      proxy.commands.some(
        (args) =>
          args[0] === 'rm' &&
          args.includes('--force') &&
          args.some((arg) => arg.endsWith('-cancel')),
      ),
    ).toBe(true);
  });

  it('confirms a stopped sandbox before crediting cancellation containment', async () => {
    const proxy = new HostScopedCredentialProxy();
    proxy.acknowledgeDetached = true;
    const adapter = new DockerSandboxAdapter({ execute: proxy.execute });
    adapters.push(adapter);
    const lifecycleScenario = await scenario('lifecycle.cancel');

    const evidence = await adapter.runScenario(
      {
        ...lifecycleScenario,
        parameters: { delayedMarkerMs: 1, observationWindowMs: 1 },
      },
      await probeContext(probeRoots),
    );

    expect(evidence).toMatchObject({
      state: 'enforced',
      reasonCode: 'managed_sandbox_retirement_observed',
      oracle: { kind: 'delayed-marker-absence', passed: true },
      resolvedAdapterConfig: {
        effective: {
          termination: 'managed-sandbox-stop-and-remove',
          confirmedStoppedState: 'stopped',
          confirmedFinalState: 'absent',
        },
      },
    });
    expect(
      proxy.commands.some(
        (args) =>
          args[0] === 'stop' && args.some((arg) => arg.endsWith('-cancel')),
      ),
    ).toBe(true);
    expect(
      proxy.commands.some((args) => args[0] === 'ls' && args[1] === '--json'),
    ).toBe(true);
  });

  it('does not credit cancellation while the control plane reports running', async () => {
    const proxy = new HostScopedCredentialProxy();
    proxy.acknowledgeDetached = true;
    proxy.reportStoppedSandboxAsRunning = true;
    const adapter = new DockerSandboxAdapter({ execute: proxy.execute });
    adapters.push(adapter);

    const evidence = await adapter.runScenario(
      {
        ...(await scenario('lifecycle.cancel')),
        parameters: { delayedMarkerMs: 1, observationWindowMs: 1 },
      },
      await probeContext(probeRoots),
    );

    expect(evidence).toMatchObject({
      state: 'failed-open',
      oracle: { passed: false },
      resolvedAdapterConfig: {
        effective: { confirmedStoppedState: 'running' },
      },
    });
  });

  it('proves partial-launch cleanup and repeated close with backend state', async () => {
    const proxy = new HostScopedCredentialProxy();
    const adapter = new DockerSandboxAdapter({ execute: proxy.execute });
    adapters.push(adapter);
    const context = await probeContext(probeRoots);

    const partialLaunch = await adapter.runScenario(
      await scenario('lifecycle.partial-launch'),
      context,
    );
    const repeatedClose = await adapter.runScenario(
      await scenario('lifecycle.repeated-close'),
      context,
    );

    expect(partialLaunch).toMatchObject({
      state: 'enforced',
      reasonCode: 'preflight_failure_left_no_backend_resource',
      oracle: { passed: true, observed: 'absent' },
    });
    expect(repeatedClose).toMatchObject({
      state: 'enforced',
      reasonCode: 'repeated_adapter_close_observed',
      oracle: {
        passed: true,
        observed: { first: 'absent', second: 'absent' },
      },
    });
  });

  it('does not count an already-present secret as an explicit resume rebind', async () => {
    const proxy = new HostScopedCredentialProxy();
    const adapter = new DockerSandboxAdapter({ execute: proxy.execute });
    adapters.push(adapter);
    const context = await probeContext(probeRoots);
    await adapter.runScenario(
      await scenario('credential.allowed-origin'),
      context,
    );
    proxy.failSecretRemoval = true;
    await adapter.runScenario(await scenario('credential.revocation'), context);

    const resume = await adapter.runScenario(
      await scenario('credential.resume'),
      context,
    );

    expect(resume).toMatchObject({
      state: 'failed-open',
      oracle: { passed: false },
    });
    expect(
      proxy.commands.filter(
        (args) => args[0] === 'secret' && args[1] === 'set-custom',
      ),
    ).toHaveLength(1);
  });
});

async function scenario(id: string): Promise<SandboxScenario> {
  const catalog = await loadScenarioCatalog();
  const found = catalog.scenarios.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing scenario ${id}`);
  return found;
}

async function probeContext(probeRoots: string[]): Promise<ProbeContext> {
  const probeRoot = await mkdtemp(
    path.join(os.tmpdir(), 'docker-adapter-test-'),
  );
  probeRoots.push(probeRoot);
  return {
    runId: 'adapter-test',
    recordedAt: () => '2026-08-24T00:00:00.000Z',
    probeRoot,
    deadline: '2026-08-24T00:01:00.000Z',
    signal: new AbortController().signal,
  };
}
