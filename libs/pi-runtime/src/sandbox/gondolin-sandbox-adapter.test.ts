import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { SandboxLaunchPlan } from '@themoltnet/runtime-core';
import { resolveRuntimeProfile } from '@themoltnet/runtime-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertBrokeredSecretNamesDoNotCollide,
  type ManagedVm,
  type VmConfig,
} from '../vm-manager.js';
import {
  createGondolinSandboxAdapter,
  GONDOLIN_SANDBOX_ADAPTER_ID,
} from './gondolin-sandbox-adapter.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'gondolin-adapter-'));
  roots.push(root);
  return root;
}

function plan(
  hostPath: string,
  overrides: Partial<SandboxLaunchPlan> = {},
): SandboxLaunchPlan {
  return {
    workspace: { hostPath, mode: 'read-write' },
    filesystem: {
      workspace: 'read-write',
      denyPaths: ['protected'],
      denyMode: 'deny',
    },
    network: {
      allowedHosts: ['127.0.0.1'],
      allowedInternalHosts: ['127.0.0.1'],
    },
    env: { CONFORMANCE_MARKER: '1' },
    credentials: [],
    requirements: {
      'filesystem-scope': 'required',
      'network-egress': 'preferred',
    },
    ...overrides,
  };
}

function fakeVm(
  options: {
    execImpl?: (
      cmd: unknown,
      opts: { signal?: AbortSignal },
    ) => Promise<unknown>;
  } = {},
) {
  const close = vi.fn(async () => undefined);
  const exec = vi.fn((cmd: unknown, opts: { signal?: AbortSignal }) =>
    options.execImpl
      ? options.execImpl(cmd, opts)
      : Promise.resolve({ exitCode: 0, stdout: 'ok', stderr: '' }),
  );
  return { close, exec };
}

function fakeResume(vm: ReturnType<typeof fakeVm>) {
  const calls: VmConfig[] = [];
  const resume = vi.fn(async (config: VmConfig): Promise<ManagedVm> => {
    calls.push(config);
    return {
      vm: vm as unknown as ManagedVm['vm'],
      credentials: {} as ManagedVm['credentials'],
      mountPath: config.mountPath,
      guestWorkspace: config.mountPath,
      agentDir: '',
    };
  });
  return { resume, calls };
}

describe('createGondolinSandboxAdapter', () => {
  it('declares every capability with a locus and reports host powers outside containment', () => {
    const adapter = createGondolinSandboxAdapter({
      checkpoint: '/nonexistent.qcow2',
    });
    const report = adapter.describe();
    expect(report.adapter.id).toBe(GONDOLIN_SANDBOX_ADAPTER_ID);
    expect(report.capabilities.map((c) => c.capability).sort()).toEqual([
      'brokered-credential',
      'child-process-containment',
      'filesystem-scope',
      'host-env-isolation',
      'network-egress',
      'resource-limits',
      'timeout-cancellation',
    ]);
    expect(
      report.capabilities.find((c) => c.capability === 'network-egress')
        ?.reason,
    ).toMatch(/hostname-granular/);
    expect(report.hostPowers).toEqual([
      { power: 'host-exec', locus: 'outside-containment' },
      { power: 'host-mcp', locus: 'outside-containment' },
    ]);
  });

  it('fails preflight without launching when the checkpoint, workspace, or plan is unusable', async () => {
    const vm = fakeVm();
    const { resume } = fakeResume(vm);
    const adapter = createGondolinSandboxAdapter({
      checkpoint: '/nonexistent.qcow2',
      resume,
    });
    const result = await adapter.preflight(
      plan('/definitely/not/a/dir', {
        workspace: { hostPath: '/definitely/not/a/dir', mode: 'read-only' },
        filesystem: {
          workspace: 'read-only',
          denyPaths: ['/abs'],
          denyMode: 'deny',
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code).sort()).toEqual([
      'adapter_unavailable',
      'plan_invalid',
      'plan_invalid',
      'workspace_unavailable',
    ]);
    expect(resume).not.toHaveBeenCalled();
  });

  it('maps the launch plan onto resumeVm in host-authenticated mode with brokered secrets resolved just in time', async () => {
    // Arrange
    const hostPath = workspace();
    const vm = fakeVm();
    const { resume, calls } = fakeResume(vm);
    const resolve = vi.fn(async () => 'synthetic-value');
    const adapter = createGondolinSandboxAdapter({
      checkpoint: async () => '/tmp/checkpoint.qcow2',
      resume,
    });
    const launchPlan = plan(hostPath, {
      resources: { memory: '2G', cpus: 1 },
      credentials: [
        {
          requirementId: 'api',
          envName: 'API_TOKEN',
          destinationHosts: ['127.0.0.1'],
          bindingRef: 'test:synthetic',
          resolve,
        },
      ],
    });

    // Act
    const handle = await adapter.launch(launchPlan);

    // Assert
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    const config = calls[0];
    expect(config).toMatchObject({
      checkpointPath: '/tmp/checkpoint.qcow2',
      guestCredentialMode: 'host-authenticated',
      mountPath: hostPath,
      agentRootDir: hostPath,
      workspaceMode: 'scratch_mount',
      sandboxConfig: {
        network: {
          allowedHosts: ['127.0.0.1'],
          allowedInternalHosts: ['127.0.0.1'],
        },
        vfs: { shadow: ['protected'], shadowMode: 'deny' },
        env: { CONFORMANCE_MARKER: '1' },
        resources: { memory: '2G', cpus: 1 },
      },
      brokeredSecrets: {
        API_TOKEN: { hosts: ['127.0.0.1'], value: 'synthetic-value' },
      },
    });
    expect(config.forwardEnv).toBeUndefined();
    expect(config.sandboxConfig?.snapshot).toBeUndefined();
    expect(config.sandboxConfig?.resumeCommands).toBeUndefined();
    expect(handle.guestWorkspace).toBe(hostPath);
    expect(JSON.stringify(handle.observe())).not.toContain('synthetic-value');
    const enforced = handle
      .observe()
      .filter((r) => r.state === 'enforced')
      .map((r) => r.control);
    expect(enforced).toContain('brokered-credential');
    expect(
      handle.observe().find((r) => r.control === 'host-exec'),
    ).toMatchObject({
      locus: 'outside-containment',
      state: 'unsupported',
    });
  });

  it('runs commands through /bin/sh in the workspace and maps timeout and cancellation', async () => {
    // Arrange
    const hostPath = workspace();
    const vm = fakeVm({
      execImpl: (_cmd, opts) =>
        new Promise((resolveExec, reject) => {
          const timer = setTimeout(
            () => resolveExec({ exitCode: 0, stdout: 'late', stderr: '' }),
            5_000,
          );
          opts.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        }),
    });
    const { resume } = fakeResume(vm);
    const adapter = createGondolinSandboxAdapter({
      checkpoint: '/tmp/cp.qcow2',
      resume,
    });
    const handle = await adapter.launch(plan(hostPath));

    // Act
    const timedOut = await handle.exec('sleep 30', { timeoutMs: 50 });
    const controller = new AbortController();
    const pending = handle.exec('sleep 30', { signal: controller.signal });
    controller.abort();
    const cancelled = await pending;

    // Assert
    expect(timedOut).toMatchObject({
      timedOut: true,
      cancelled: false,
      exitCode: 124,
    });
    expect(cancelled).toMatchObject({
      timedOut: false,
      cancelled: true,
      exitCode: 130,
    });
    expect(vm.exec).toHaveBeenCalledWith(
      ['/bin/sh', '-c', 'sleep 30'],
      expect.objectContaining({ cwd: hostPath }),
    );
  });

  it('refuses exec after close and downgrades enforced records by requirement', async () => {
    const hostPath = workspace();
    const vm = fakeVm();
    const { resume } = fakeResume(vm);
    const adapter = createGondolinSandboxAdapter({
      checkpoint: '/tmp/cp.qcow2',
      resume,
    });
    const handle = await adapter.launch(plan(hostPath));

    const report = await handle.close();

    expect(report).toEqual({ cleaned: true, residue: [] });
    expect(vm.close).toHaveBeenCalledTimes(1);
    await expect(handle.exec('true')).rejects.toThrow(/closed/);
    const latest = new Map(handle.observe().map((r) => [r.control, r.state]));
    expect(latest.get('filesystem-scope')).toBe('failed');
    expect(latest.get('network-egress')).toBe('degraded');
    expect(latest.get('host-env-isolation')).toBe('failed-open');
    expect(await handle.close()).toEqual({ cleaned: true, residue: [] });
  });

  it('reports residue when the VM cannot be closed', async () => {
    const hostPath = workspace();
    const vm = fakeVm();
    vm.close.mockRejectedValueOnce(new Error('qemu hung'));
    const { resume } = fakeResume(vm);
    const adapter = createGondolinSandboxAdapter({
      checkpoint: '/tmp/cp.qcow2',
      resume,
    });
    const handle = await adapter.launch(plan(hostPath));
    expect(await handle.close()).toEqual({
      cleaned: false,
      residue: ['vm.close failed: qemu hung'],
    });
  });

  it('resolves a portable profile end to end without reading a secret', async () => {
    const hostPath = workspace();
    const vm = fakeVm();
    const { resume } = fakeResume(vm);
    const resolve = vi.fn(async () => 'never-read-at-resolution');
    const adapter = createGondolinSandboxAdapter({
      checkpoint: async () => '/tmp/cp.qcow2',
      resume,
    });

    const outcome = await resolveRuntimeProfile(
      {
        ref: { id: 'profile', revision: 2 },
        toolPolicy: {
          enforcement: 'enforce',
          allowedTools: ['git'],
          allowedShellCommands: [['git', 'status']],
        },
        sandbox: {
          filesystem: {
            workspace: 'read-write',
            denyPaths: ['.moltnet'],
            denyMode: 'deny',
          },
          network: {
            allowedHosts: ['api.example.test'],
            allowedInternalHosts: [],
          },
        },
        capabilities: {
          'filesystem-scope': 'required',
          'brokered-credential': 'required',
        },
        credentials: [
          {
            id: 'api',
            purpose: 'test',
            consumer: 'guest-process',
            destinationHosts: ['api.example.test'],
            delivery: 'brokered-http',
            envName: 'API_TOKEN',
            required: true,
          },
        ],
        runtimeInputs: [],
        context: [],
        hostPowers: ['host-exec', 'host-mcp'],
      },
      {
        sandbox: adapter,
        workspace: { hostPath },
        credentials: {
          api: {
            requirementId: 'api',
            envName: 'API_TOKEN',
            destinationHosts: ['api.example.test'],
            bindingRef: 'keyring:test',
            resolve,
          },
        },
      },
    );

    expect(outcome.ok).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    if (!outcome.ok) return;
    expect(outcome.resolved.sandboxAdapter.id).toBe('gondolin');
    expect(outcome.resolved.hostPowers).toEqual([
      { power: 'host-exec', locus: 'outside-containment' },
      { power: 'host-mcp', locus: 'outside-containment' },
    ]);
  });
});

describe('assertBrokeredSecretNamesDoNotCollide', () => {
  it('refuses a brokered secret that is also a raw env override or forwarded env', () => {
    expect(() =>
      assertBrokeredSecretNamesDoNotCollide(
        {
          API_TOKEN: { hosts: ['a'], value: 'v' },
          OTHER: { hosts: ['a'], value: 'v' },
        },
        ['OTHER'],
        { API_TOKEN: 'raw' },
      ),
    ).toThrow(/API_TOKEN, OTHER/);
    expect(() =>
      assertBrokeredSecretNamesDoNotCollide(
        { API_TOKEN: { hosts: ['a'], value: 'v' } },
        [],
        {},
      ),
    ).not.toThrow();
    expect(() =>
      assertBrokeredSecretNamesDoNotCollide(undefined, ['X'], { X: '1' }),
    ).not.toThrow();
  });
});
