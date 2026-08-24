import { mkdtemp, rm } from 'node:fs/promises';
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

  readonly execute: CommandExecutor = async (_command, args) => {
    this.commands.push(args);
    if (args[0] === 'version') {
      return { exitCode: 0, stdout: 'sbx version: v0.39.0', stderr: '' };
    }
    if (args[0] === 'secret' && args[1] === 'set-custom') {
      const valueIndex = args.indexOf('--value');
      this.credential = args[valueIndex + 1];
      return success();
    }
    if (args[0] === 'secret' && args[1] === 'rm') {
      this.credential = undefined;
      return success();
    }
    if (args[0] === 'exec') {
      const shellCommand = args.at(-1) ?? '';
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
      oracle: { observed: 1, passed: true },
    });
    expect(adjacent).toMatchObject({
      state: 'failed-open',
      reasonCode: 'adjacent_origin_secret_delivery_observed',
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
          /^127\.0\.0\.1\.nip\.io:[0-9]+$/.test(args.at(-1) ?? ''),
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
