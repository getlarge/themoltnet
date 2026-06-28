import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const gondolinMock = vi.hoisted(() => {
  const resumeCalls: unknown[] = [];
  const vm = {
    exec: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    fs: {
      writeFile: vi.fn(async () => undefined),
    },
    close: vi.fn(async () => undefined),
  };

  class MemoryProvider {}
  class RealFSProvider {
    constructor(public readonly root: string) {}
  }
  class ShadowProvider {
    constructor(
      public readonly provider: unknown,
      public readonly options: unknown,
    ) {}
  }

  return {
    resumeCalls,
    vm,
    MemoryProvider,
    RealFSProvider,
    ShadowProvider,
    createHttpHooks: vi.fn(() => ({ httpHooks: {}, env: {} })),
    createShadowPathPredicate: vi.fn(() => () => false),
    VmCheckpoint: {
      load: vi.fn(() => ({
        resume: vi.fn(async (options: unknown) => {
          resumeCalls.push(options);
          return vm;
        }),
      })),
    },
  };
});

vi.mock('@earendil-works/gondolin', () => gondolinMock);

import { GUEST_TASK_CONTEXT_MOUNT, resumeVm } from './vm-manager.js';

describe('resumeVm task-context mount', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await gondolinMock.vm.close();
    gondolinMock.resumeCalls.length = 0;
    gondolinMock.vm.exec.mockClear();
    gondolinMock.vm.fs.writeFile.mockClear();
    gondolinMock.vm.close.mockClear();
    delete process.env.MOLTNET_TEST_FORWARD_ME;
    delete process.env.MOLTNET_TEST_DO_NOT_FORWARD;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('mounts task context outside the guest workspace', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-resume-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const agentDir = path.join(root, '.moltnet', 'legreffier');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      path.join(agentDir, 'moltnet.json'),
      JSON.stringify({
        endpoints: { api: 'https://api.themolt.net' },
      }),
      'utf8',
    );
    writeFileSync(path.join(agentDir, 'env'), '', 'utf8');

    await resumeVm({
      checkpointPath: path.join(root, 'checkpoint.qcow2'),
      agentName: 'legreffier',
      agentRootDir: root,
      mountPath: workspace,
    });

    expect(gondolinMock.resumeCalls).toHaveLength(1);
    const resumeOptions = gondolinMock.resumeCalls[0] as {
      vfs: { mounts: Record<string, unknown> };
    };
    expect(Object.keys(resumeOptions.vfs.mounts).sort()).toEqual(
      [workspace, GUEST_TASK_CONTEXT_MOUNT].sort(),
    );
    expect(resumeOptions.vfs.mounts[GUEST_TASK_CONTEXT_MOUNT]).toBeInstanceOf(
      gondolinMock.MemoryProvider,
    );
    expect(resumeOptions.vfs.mounts).not.toHaveProperty(
      `${workspace}/context-pack.md`,
    );
  });

  it('forwards only explicitly allowlisted host env vars into the VM', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-env-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const agentDir = path.join(root, '.moltnet', 'legreffier');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      path.join(agentDir, 'moltnet.json'),
      JSON.stringify({
        endpoints: { api: 'https://api.themolt.net' },
      }),
      'utf8',
    );
    writeFileSync(path.join(agentDir, 'env'), '', 'utf8');
    process.env.MOLTNET_TEST_FORWARD_ME = 'forwarded';
    process.env.MOLTNET_TEST_DO_NOT_FORWARD = 'host-only';

    await resumeVm({
      checkpointPath: path.join(root, 'checkpoint.qcow2'),
      agentName: 'legreffier',
      agentRootDir: root,
      mountPath: workspace,
      forwardEnv: ['MOLTNET_TEST_FORWARD_ME'],
      sandboxConfig: {
        env: { NODE_OPTIONS: '--dns-result-order=ipv4first' },
      },
    });

    expect(gondolinMock.resumeCalls).toHaveLength(1);
    const resumeOptions = gondolinMock.resumeCalls[0] as {
      env: Record<string, string>;
    };
    expect(resumeOptions.env.MOLTNET_TEST_FORWARD_ME).toBe('forwarded');
    expect(resumeOptions.env.MOLTNET_TEST_DO_NOT_FORWARD).toBeUndefined();
    expect(resumeOptions.env.NODE_OPTIONS).toBe('--dns-result-order=ipv4first');
  });
});
