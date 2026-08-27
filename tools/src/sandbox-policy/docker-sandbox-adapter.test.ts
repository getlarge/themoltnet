import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadScenarioCatalog } from './catalog.js';
import type { CommandExecutor, CommandResult } from './command.js';
import type { DockerEngineControl } from './docker-engine-control.js';
import {
  DockerContainmentRecoveryError,
  DockerSandboxAdapter,
} from './docker-sandbox-adapter.js';
import {
  ADJACENT_FIXTURE_HOST,
  PROTECTED_FIXTURE_HOST,
} from './exact-origin-proxy.js';
import type { ProbeContext, SandboxScenario } from './types.js';

class HostScopedCredentialProxy {
  readonly commands: string[][] = [];
  credential: string | undefined;
  failSecretRemoval = false;
  acknowledgeDetached = false;
  daemonStopped = false;
  daemonStatusReportsRunning = false;
  engineRetirementConfirmed = true;
  proxyUrl: string | undefined;
  stoppedSandbox: string | undefined;
  readonly sandboxNames = new Set<string>();
  reportStoppedSandboxAsRunning = false;

  readonly execute: CommandExecutor = async (_command, args) => {
    this.commands.push(args);
    if (args[0] === 'version') {
      return { exitCode: 0, stdout: 'sbx version: v0.39.0', stderr: '' };
    }
    if (args[0] === 'daemon' && args[1] === 'stop') {
      this.daemonStopped = true;
      this.stoppedSandbox = [...this.sandboxNames].at(-1);
      return success();
    }
    if (args[0] === 'daemon' && args[1] === 'start') {
      this.daemonStopped = false;
      return success();
    }
    if (args[0] === 'daemon' && args[1] === 'status') {
      const stopped = this.daemonStopped && !this.daemonStatusReportsRunning;
      return {
        exitCode: 0,
        stdout: stopped
          ? 'Status: stopped\nSocket: test.sock (not connected)\n'
          : 'Status: running\nSocket: /tmp/d_moltnet-unit-test/sandboxd.sock\n',
        stderr: '',
      };
    }
    if (args[0] === 'settings' && args[1] === 'get') {
      const value = args[2] === 'proxy.sandbox' ? this.proxyUrl : undefined;
      return { exitCode: 0, stdout: value ? `${value}\n` : '\n', stderr: '' };
    }
    if (
      args[0] === 'settings' &&
      args[1] === 'set' &&
      args[2] === 'proxy.sandbox'
    ) {
      this.proxyUrl = args[3];
      return success();
    }
    if (
      args[0] === 'settings' &&
      args[1] === 'unset' &&
      args[2] === 'proxy.sandbox'
    ) {
      this.proxyUrl = undefined;
      return success();
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
              (this.daemonStopped || name === this.stoppedSandbox) &&
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
      if (shellCommand.includes('printf started') && this.acknowledgeDetached) {
        const started = /printf started > '([^']+)'/.exec(shellCommand)?.[1];
        if (started) await writeFile(started, 'started');
        return success();
      }
      if (
        shellCommand.includes('http://127.0.0.1:') &&
        !shellCommand.includes('--noproxy')
      ) {
        return { exitCode: 7, stdout: '', stderr: 'connection refused' };
      }
      const target = /https?:\/\/[^'" ]+/.exec(shellCommand)?.[0];
      if (target) {
        return requestFixture(
          target,
          this.credential,
          this.proxyUrl,
          shellCommand.includes(' -L'),
          shellCommand.includes('-fsS') || shellCommand.includes('-kfsS'),
        );
      }
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
  proxyUrl: string | undefined,
  followRedirect = false,
  failOnHttp = false,
): Promise<CommandResult> {
  const url = new URL(target);
  const useProxy =
    proxyUrl !== undefined &&
    [PROTECTED_FIXTURE_HOST, ADJACENT_FIXTURE_HOST].includes(url.hostname);
  const proxy = useProxy ? new URL(proxyUrl) : undefined;
  return new Promise((resolve, reject) => {
    const fixtureRequest = request(
      {
        host: proxy?.hostname ?? '127.0.0.1',
        port: proxy?.port ?? url.port,
        path: proxy ? target : `${url.pathname}${url.search}`,
        headers: credential
          ? { authorization: `Bearer ${credential}` }
          : undefined,
      },
      (response) => {
        const location = response.headers.location;
        if (
          followRedirect &&
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          location
        ) {
          response.resume();
          response.once('end', () => {
            void requestFixture(
              location,
              credential,
              proxyUrl,
              false,
              failOnHttp,
            ).then(resolve, reject);
          });
          return;
        }
        response.resume();
        response.once('end', () =>
          resolve({
            exitCode:
              !failOnHttp || (response.statusCode && response.statusCode < 400)
                ? 0
                : 22,
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

  it('uses the trusted proxy to constrain a native host-scoped secret to one origin', async () => {
    const proxy = new HostScopedCredentialProxy();
    const adapter = createAdapter(proxy);
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
      state: 'enforced',
      reasonCode: 'adjacent_origin_secret_not_substituted',
      oracle: {
        observed: {
          negativeCredentialMatches: 0,
          negativeFixtureRequests: 4,
          protectedRedirectMatches: 1,
          proxyDecisions: 6,
        },
        passed: true,
      },
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
          (args.at(-1) ?? '').startsWith(`${PROTECTED_FIXTURE_HOST}:`),
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
    const adapter = createAdapter(proxy);
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
    const adapter = createAdapter(proxy);
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
          adjacentRequests: 1,
          guestExitCode: 0,
        },
        passed: false,
      },
    });
  });

  it('rejects an unacknowledged detached child and registers its cleanup', async () => {
    const proxy = new HostScopedCredentialProxy();
    const adapter = createAdapter(proxy);
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

  it('retires the identity-verified engine container before crediting cancellation containment', async () => {
    const proxy = new HostScopedCredentialProxy();
    proxy.acknowledgeDetached = true;
    const adapter = createAdapter(proxy);
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
      reasonCode: 'managed_engine_retirement_observed',
      oracle: { kind: 'delayed-marker-absence', passed: true },
      resolvedAdapterConfig: {
        effective: {
          termination: 'identity-verified-engine-kill',
          confirmedIdentity: true,
          confirmedEngineState: 'stopped',
          confirmedStoppedState: 'stopped',
          confirmedFinalState: 'absent',
        },
      },
    });
    expect(
      proxy.commands.filter(
        (args) => args[0] === 'daemon' && args[1] === 'stop',
      ),
    ).toHaveLength(1);
    expect(
      proxy.commands.some((args) => args[0] === 'ls' && args[1] === '--json'),
    ).toBe(true);
  });

  it('poisons the adapter when identity-verified engine retirement is unconfirmed', async () => {
    const proxy = new HostScopedCredentialProxy();
    proxy.acknowledgeDetached = true;
    proxy.engineRetirementConfirmed = false;
    const adapter = createAdapter(proxy);
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
      reasonCode: 'managed_engine_retirement_unconfirmed',
      oracle: { passed: false },
      resolvedAdapterConfig: {
        effective: { confirmedEngineState: 'unconfirmed' },
      },
    });
    await expect(
      adapter.runScenario(
        await scenario('resource.cpu'),
        await probeContext(probeRoots),
      ),
    ).rejects.toBeInstanceOf(DockerContainmentRecoveryError);
  });

  it('proves partial-launch cleanup and repeated close with backend state', async () => {
    const proxy = new HostScopedCredentialProxy();
    const adapter = createAdapter(proxy);
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
    const adapter = createAdapter(proxy);
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

function createAdapter(proxy: HostScopedCredentialProxy): DockerSandboxAdapter {
  const engineControl: DockerEngineControl = {
    retireSandbox: async ({ sandboxName }) => {
      if (!proxy.engineRetirementConfirmed) {
        return {
          confirmed: false,
          exitCode: null,
          identityConfirmed: true,
          killStatus: 204,
        };
      }
      proxy.stoppedSandbox = sandboxName;
      return {
        confirmed: true,
        exitCode: 137,
        identityConfirmed: true,
        killStatus: 204,
      };
    },
  };
  return new DockerSandboxAdapter({
    appName: 'moltnet-unit-test',
    engineControl,
    execute: proxy.execute,
  });
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
