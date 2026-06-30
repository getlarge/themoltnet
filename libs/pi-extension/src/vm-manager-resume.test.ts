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

import {
  GUEST_TASK_CONTEXT_MOUNT,
  PACKAGE_MANAGER_STORE_ENV_KEYS,
  resolvePackageManagerStoreDirs,
  resumeVm,
} from './vm-manager.js';

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

  it('prepares configured package-manager stores and caches as guest-local directories', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-pm-cache-'));
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
      sandboxConfig: {
        env: {
          NPM_CONFIG_STORE_DIR: '/opt/pnpm-store',
          NPM_CONFIG_CACHE: '/opt/npm-cache',
          YARN_CACHE_FOLDER: '/opt/yarn-cache',
        },
      },
    });

    const resumeOptions = gondolinMock.resumeCalls[0] as {
      env: Record<string, string>;
      vfs: { mounts: Record<string, unknown> };
    };
    for (const key of PACKAGE_MANAGER_STORE_ENV_KEYS) {
      expect(resumeOptions.env[key]).toBeDefined();
    }
    for (const mountPath of [
      '/opt/npm-cache',
      '/opt/pnpm-store',
      '/opt/yarn-cache',
    ]) {
      expect(resumeOptions.vfs.mounts).not.toHaveProperty(mountPath);
    }

    const execCalls = gondolinMock.vm.exec.mock.calls as unknown as [
      unknown,
      unknown?,
    ][];
    const shellCommands = execCalls
      .map(([argv]) => (Array.isArray(argv) ? argv[2] : argv))
      .filter((command): command is string => typeof command === 'string');
    const storeCommand = shellCommands.find((command) =>
      command.includes("chown 501:501 '/opt/pnpm-store'"),
    );
    expect(storeCommand).toContain("mkdir -p '/opt/npm-cache'");
    expect(storeCommand).toContain("chown 501:501 '/opt/npm-cache'");
    expect(storeCommand).toContain("chmod 0755 '/opt/npm-cache'");
    expect(storeCommand).toContain("mkdir -p '/opt/pnpm-store'");
    expect(storeCommand).toContain("mkdir -p '/opt/yarn-cache'");
    expect(storeCommand).not.toContain('mount -t tmpfs');
  });

  it('ignores relative and interpolated package-manager paths', () => {
    expect(
      resolvePackageManagerStoreDirs({
        NPM_CONFIG_STORE_DIR: '.pnpm-store',
        NPM_CONFIG_CACHE: '${MOLTNET_GUEST_CWD}/.npm-cache',
        YARN_CACHE_FOLDER: '/opt/yarn-cache',
      }),
    ).toEqual(['/opt/yarn-cache']);
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

  it('shadows future node_modules paths with tmpfs before resume commands run', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-cwd-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const cwd = path.join(workspace, '.worktrees', 'task-1');
    const agentDir = path.join(root, '.moltnet', 'legreffier');
    mkdirSync(cwd, { recursive: true });
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
      cwdPath: cwd,
      workspaceMode: 'dedicated_worktree',
      sandboxConfig: {
        resumeCommands: [
          {
            run: 'cd "$MOLTNET_GUEST_CWD" && pnpm install --frozen-lockfile',
            when: { workspaceMode: ['dedicated_worktree'] },
          },
        ],
      },
    });

    expect(gondolinMock.resumeCalls).toHaveLength(1);
    const resumeOptions = gondolinMock.resumeCalls[0] as {
      env: Record<string, string>;
      vfs: { mounts: Record<string, unknown> };
    };
    expect(resumeOptions.env.MOLTNET_GUEST_WORKSPACE).toBe(workspace);
    expect(resumeOptions.env.MOLTNET_GUEST_CWD).toBe(cwd);
    const mounts = resumeOptions.vfs.mounts;
    expect(mounts[workspace]).toBeInstanceOf(gondolinMock.ShadowProvider);
    const workspaceProvider = mounts[workspace] as {
      options: {
        denySymlinkBypass: boolean;
        shouldShadow: (ctx: { path: string }) => boolean;
      };
    };
    expect(workspaceProvider.options.denySymlinkBypass).toBe(false);
    expect(
      workspaceProvider.options.shouldShadow({
        path: '/.worktrees/later/packages/web/node_modules/.bin/vite',
      }),
    ).toBe(true);
    expect(
      workspaceProvider.options.shouldShadow({
        path: '/.worktrees/later/packages/web/src/index.ts',
      }),
    ).toBe(false);

    const execCalls = gondolinMock.vm.exec.mock.calls as unknown as [
      unknown,
      unknown?,
    ][];
    const shellCommands = execCalls
      .map(([argv]) => (Array.isArray(argv) ? argv[2] : argv))
      .filter((command): command is string => typeof command === 'string');
    const profileCommandIndex = shellCommands.findIndex((command) =>
      command.includes('pnpm install --frozen-lockfile'),
    );

    expect(profileCommandIndex).toBeGreaterThanOrEqual(0);
    expect(shellCommands[profileCommandIndex]).toContain(
      'cd "$MOLTNET_GUEST_CWD" && pnpm install --frozen-lockfile',
    );
  });

  it('keeps caller-provided deny shadows authoritative over built-in node_modules tmpfs', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-shadow-order-'));
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
      sandboxConfig: {
        vfs: { shadow: ['**'], shadowMode: 'deny' },
      },
    });

    const resumeOptions = gondolinMock.resumeCalls[0] as {
      vfs: { mounts: Record<string, unknown> };
    };
    const outerProvider = resumeOptions.vfs.mounts[workspace] as {
      provider: unknown;
      options: { writeMode: string };
    };
    expect(outerProvider).toBeInstanceOf(gondolinMock.ShadowProvider);
    expect(outerProvider.options.writeMode).toBe('deny');
    expect(outerProvider.provider).toBeInstanceOf(gondolinMock.ShadowProvider);
    expect(
      (outerProvider.provider as { options: { writeMode: string } }).options
        .writeMode,
    ).toBe('tmpfs');
    expect(
      (
        outerProvider.provider as {
          options: { denySymlinkBypass: boolean };
        }
      ).options.denySymlinkBypass,
    ).toBe(false);
  });
});
