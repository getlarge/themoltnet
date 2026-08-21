import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ManagedVm, VmConfig } from '@themoltnet/pi-runtime';
import { GONDOLIN_BASE_ALLOWED_HOSTS } from '@themoltnet/pi-runtime';
import type { SandboxLaunchPlan } from '@themoltnet/runtime-core';
import { resolveGovernanceIntent } from '@themoltnet/runtime-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

function checkpoint(): string {
  const dir = workspace();
  const file = path.join(dir, 'checkpoint.qcow2');
  writeFileSync(file, '');
  return file;
}

function plan(
  hostPath: string,
  overrides: Partial<SandboxLaunchPlan> = {},
): SandboxLaunchPlan {
  const requested = {
    allowedDestinations: [{ host: 'allowed.lvh.me' }],
    allowedInternalHosts: ['allowed.lvh.me'],
    acceptPlatformEgress: true,
  };
  return {
    workspace: { hostPath, mode: 'read-write' },
    filesystem: {
      workspace: 'read-write',
      denyPaths: ['protected'],
      denyMode: 'deny',
    },
    network: {
      requested,
      effective: {
        allowedDestinations: [
          ...requested.allowedDestinations,
          { host: 'api.themolt.net' },
        ],
        allowedInternalHosts: requested.allowedInternalHosts,
      },
      fidelity: 'host',
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

type ExecImpl = (
  cmd: unknown,
  opts: { signal?: AbortSignal },
) => Promise<unknown>;

function fakeVm(options: { execImpl?: ExecImpl } = {}) {
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
  it('declares host fidelity, mandatory platform egress, and host powers outside containment', () => {
    const adapter = createGondolinSandboxAdapter({
      checkpoint: '/nonexistent.qcow2',
    });
    const report = adapter.describe();
    expect(report.adapter.id).toBe(GONDOLIN_SANDBOX_ADAPTER_ID);
    expect(report.network.fidelity).toBe('host');
    expect(report.network.mandatoryEgress.map((d) => d.host)).toEqual([
      ...GONDOLIN_BASE_ALLOWED_HOSTS,
      'api.themolt.net',
    ]);
    expect(report.capabilities.map((c) => c.capability).sort()).toEqual([
      'brokered-credential',
      'child-process-containment',
      'filesystem-scope',
      'host-env-isolation',
      'network-egress',
      'resource-limits',
      'timeout-cancellation',
    ]);
    expect(report.hostPowers).toEqual([
      { power: 'host-exec', locus: 'outside-containment' },
      { power: 'host-mcp', locus: 'outside-containment' },
    ]);
  });

  it('fails preflight without launching on unusable checkpoint, workspace, plan, or port-scoped destinations', async () => {
    const vm = fakeVm();
    const { resume } = fakeResume(vm);
    const adapter = createGondolinSandboxAdapter({
      checkpoint: '/nonexistent.qcow2',
      resume,
    });
    const base = plan('/definitely/not/a/dir');
    const result = await adapter.preflight({
      ...base,
      workspace: { hostPath: '/definitely/not/a/dir', mode: 'read-only' },
      filesystem: {
        workspace: 'read-only',
        denyPaths: ['/abs'],
        denyMode: 'deny',
      },
      network: {
        ...base.network,
        requested: {
          ...base.network.requested,
          allowedDestinations: [{ host: 'a.lvh.me', port: 8080 }],
        },
      },
      credentials: [
        {
          requirementId: 'a',
          envName: 'TOK',
          destinations: [{ host: 'a.lvh.me' }],
          bindingRef: 'x',
          resolve: async () => 'v',
        },
        {
          requirementId: 'b',
          envName: 'TOK',
          destinations: [{ host: 'a.lvh.me' }],
          bindingRef: 'y',
          resolve: async () => 'v',
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code).sort()).toEqual([
      'adapter_unavailable',
      'credential_binding_duplicate',
      'plan_invalid',
      'plan_invalid',
      'plan_invalid',
      'workspace_unavailable',
    ]);
    expect(resume).not.toHaveBeenCalled();
  });

  it('validates checkpoint and cancellation before reading any secret', async () => {
    const hostPath = workspace();
    const { resume } = fakeResume(fakeVm());
    const resolve = vi.fn(async () => 'synthetic-value');
    const credentials = [
      {
        requirementId: 'api',
        envName: 'API_TOKEN',
        destinations: [{ host: 'allowed.lvh.me' }],
        bindingRef: 't',
        resolve,
      },
    ];
    const missing = createGondolinSandboxAdapter({
      checkpoint: async () => '/nonexistent.qcow2',
      resume,
    });
    await expect(
      missing.launch(plan(hostPath, { credentials })),
    ).rejects.toThrow(/checkpoint does not exist/);
    const aborted = new AbortController();
    aborted.abort();
    const ok = createGondolinSandboxAdapter({
      checkpoint: checkpoint(),
      resume,
    });
    await expect(
      ok.launch(plan(hostPath, { credentials }), { signal: aborted.signal }),
    ).rejects.toThrow(/aborted/);
    expect(resolve).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it('maps the launch plan onto resumeVm in host-authenticated mode with brokered secrets resolved just in time', async () => {
    const hostPath = workspace();
    const vm = fakeVm();
    const { resume, calls } = fakeResume(vm);
    const resolve = vi.fn(async () => 'synthetic-value');
    const adapter = createGondolinSandboxAdapter({
      checkpoint: checkpoint(),
      resume,
    });
    const handle = await adapter.launch(
      plan(hostPath, {
        resources: { memory: '2G', cpus: 1 },
        credentials: [
          {
            requirementId: 'api',
            envName: 'API_TOKEN',
            destinations: [{ host: 'allowed.lvh.me' }],
            bindingRef: 't',
            resolve,
          },
        ],
      }),
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    const config = calls[0];
    expect(config).toMatchObject({
      guestCredentialMode: 'host-authenticated',
      mountPath: hostPath,
      agentRootDir: hostPath,
      workspaceMode: 'scratch_mount',
      sandboxConfig: {
        network: {
          allowedHosts: ['allowed.lvh.me'],
          allowedInternalHosts: ['allowed.lvh.me'],
        },
        vfs: { shadow: ['protected'], shadowMode: 'deny' },
        env: { CONFORMANCE_MARKER: '1' },
        resources: { memory: '2G', cpus: 1 },
      },
      brokeredSecrets: {
        API_TOKEN: { hosts: ['allowed.lvh.me'], value: 'synthetic-value' },
      },
    });
    expect(config.forwardEnv).toBeUndefined();
    expect(config.sandboxConfig?.snapshot).toBeUndefined();
    expect(config.sandboxConfig?.resumeCommands).toBeUndefined();
    expect(JSON.stringify(handle.observe())).not.toContain('synthetic-value');
    const latest = new Map(handle.observe().map((r) => [r.control, r]));
    expect(latest.get('filesystem-scope')).toMatchObject({
      state: 'enforced',
      basis: 'applied',
    });
    expect(latest.get('resource-limits')).toMatchObject({
      state: 'enforced',
      basis: 'applied',
    });
    expect(latest.get('timeout-cancellation')).toMatchObject({
      basis: 'declared',
    });
    expect(latest.get('host-exec')).toMatchObject({
      locus: 'outside-containment',
      state: 'unsupported',
    });
  });

  it('runs commands as a guest session leader and kills the process group on timeout or cancellation', async () => {
    const hostPath = workspace();
    const killCalls: unknown[] = [];
    const vm = fakeVm({
      execImpl: (cmd, opts) => {
        const argv = cmd as string[];
        if (argv[3] === 'moltnet-kill') {
          killCalls.push(argv);
          return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
        }
        return new Promise((resolveExec, reject) => {
          const timer = setTimeout(
            () => resolveExec({ exitCode: 0, stdout: 'late', stderr: '' }),
            5_000,
          );
          opts.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('exec aborted'));
          });
        });
      },
    });
    const { resume } = fakeResume(vm);
    const adapter = createGondolinSandboxAdapter({
      checkpoint: checkpoint(),
      resume,
    });
    const handle = await adapter.launch(plan(hostPath));

    const timedOut = await handle.exec('sleep 30', { timeoutMs: 50 });
    const controller = new AbortController();
    const pending = handle.exec('sleep 30', { signal: controller.signal });
    controller.abort();
    const cancelled = await pending;

    expect(timedOut).toMatchObject({
      timedOut: true,
      cancelled: false,
      exitCode: 124,
      terminationConfirmed: true,
    });
    expect(cancelled).toMatchObject({
      timedOut: false,
      cancelled: true,
      exitCode: 130,
      terminationConfirmed: true,
    });
    expect(killCalls).toHaveLength(2);
    const wrapped = vm.exec.mock.calls[0][0] as string[];
    expect(wrapped[0]).toBe('/bin/sh');
    expect(wrapped[2]).toContain('setsid /bin/sh -c "$1"');
    expect(wrapped[4]).toBe('sleep 30');
    expect(wrapped[5]).toMatch(/^\/tmp\/\.moltnet-exec-[0-9a-f]+\.pgid$/);
    const records = handle
      .observe()
      .filter(
        (r) => r.control === 'timeout-cancellation' && r.basis === 'applied',
      );
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.state === 'enforced')).toBe(true);
  });

  it('reports failed-open when the process group cannot be confirmed terminated', async () => {
    const hostPath = workspace();
    const vm = fakeVm({
      execImpl: (cmd, opts) => {
        const argv = cmd as string[];
        if (argv[3] === 'moltnet-kill')
          return Promise.resolve({ exitCode: 3, stdout: '', stderr: '' });
        return new Promise((_r, reject) => {
          opts.signal?.addEventListener('abort', () => {
            reject(new Error('exec aborted'));
          });
        });
      },
    });
    const { resume } = fakeResume(vm);
    const adapter = createGondolinSandboxAdapter({
      checkpoint: checkpoint(),
      resume,
    });
    const handle = await adapter.launch(plan(hostPath));
    const r = await handle.exec('sleep 30', { timeoutMs: 20 });
    expect(r).toMatchObject({ timedOut: true, terminationConfirmed: false });
    const latest = [...handle.observe()]
      .reverse()
      .find((x) => x.control === 'timeout-cancellation');
    expect(latest).toMatchObject({ state: 'failed-open', basis: 'applied' });
  });

  it('refuses exec after close, downgrades enforced records by requirement, and memoizes cleanup', async () => {
    const hostPath = workspace();
    const vm = fakeVm();
    vm.close.mockRejectedValueOnce(new Error('qemu hung'));
    const { resume } = fakeResume(vm);
    const adapter = createGondolinSandboxAdapter({
      checkpoint: checkpoint(),
      resume,
    });
    const handle = await adapter.launch(plan(hostPath));

    const first = await handle.close();
    const second = await handle.close();

    expect(first).toEqual({
      cleaned: false,
      residue: ['vm.close failed: qemu hung'],
    });
    expect(second).toBe(first);
    expect(vm.close).toHaveBeenCalledTimes(1);
    await expect(handle.exec('true')).rejects.toThrow(/closed/);
    const latest = new Map(handle.observe().map((r) => [r.control, r.state]));
    expect(latest.get('filesystem-scope')).toBe('failed');
    expect(latest.get('network-egress')).toBe('degraded');
    expect(latest.get('host-env-isolation')).toBe('failed-open');
  });

  it('resolves a portable intent end to end: platform egress merged, port-scoped credential refused, no secret read', async () => {
    const hostPath = workspace();
    const { resume } = fakeResume(fakeVm());
    const resolve = vi.fn(async () => 'never-read-at-resolution');
    const adapter = createGondolinSandboxAdapter({
      checkpoint: checkpoint(),
      resume,
    });
    const base = {
      ref: { id: 'profile', revision: 2 },
      toolPolicy: {
        enforcement: 'enforce' as const,
        allowedTools: ['git'],
        allowedShellCommands: [['git', 'status']],
      },
      sandbox: {
        filesystem: {
          workspace: 'read-write' as const,
          denyPaths: ['.moltnet'],
          denyMode: 'deny' as const,
        },
        network: {
          allowedDestinations: [{ host: 'api.example.test' }],
          allowedInternalHosts: [],
          acceptPlatformEgress: true,
        },
      },
      capabilities: {
        'filesystem-scope': 'required' as const,
        'brokered-credential': 'required' as const,
      },
      credentials: [
        {
          id: 'api',
          purpose: 'test',
          consumer: 'guest-process' as const,
          destinations: [{ host: 'api.example.test' }],
          delivery: 'brokered-http' as const,
          envName: 'API_TOKEN',
          required: true,
        },
      ],
      runtimeInputs: [],
      context: [],
      hostPowers: ['host-exec' as const, 'host-mcp' as const],
    };
    const trusted = {
      sandbox: adapter,
      workspace: { hostPath },
      credentials: {
        api: {
          requirementId: 'api',
          envName: 'API_TOKEN',
          destinations: [{ host: 'api.example.test' }],
          bindingRef: 'keyring:test',
          probe: async () => ({
            code: 'ready' as const,
            provider: 'os-keyring',
          }),
          resolve,
        },
      },
    };

    const ok = await resolveGovernanceIntent(base, trusted);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.plan.network.mandatoryEgress.map((d) => d.host)).toContain(
      'api.themolt.net',
    );
    expect(
      ok.plan.network.effective.allowedDestinations.map((d) => d.host),
    ).toContain('github.com');
    expect(resolve).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();

    const portScoped = await resolveGovernanceIntent(
      {
        ...base,
        credentials: [
          {
            ...base.credentials[0],
            destinations: [{ host: 'api.example.test', port: 443 }],
          },
        ],
      },
      trusted,
    );
    expect(portScoped.ok).toBe(false);
    if (portScoped.ok) return;
    expect(portScoped.failures[0]).toMatchObject({
      code: 'capability_degraded',
      capability: 'brokered-credential',
    });
  });
});
