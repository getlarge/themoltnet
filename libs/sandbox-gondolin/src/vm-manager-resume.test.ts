import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const gondolinMock = vi.hoisted(() => {
  const resumeCalls: unknown[] = [];
  const vm = {
    exec: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    fs: {
      writeFile: vi.fn(
        async (
          _filePath: string,
          _data: string | Uint8Array,
          _options?: unknown,
        ) => undefined,
      ),
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

  const secretManager = {
    listSecrets: vi.fn(() => []),
    updateSecret: vi.fn(() => undefined),
    deleteSecret: vi.fn(() => undefined),
  };

  return {
    resumeCalls,
    vm,
    MemoryProvider,
    RealFSProvider,
    ShadowProvider,
    secretManager,
    createHttpHooks: vi.fn(
      (
        options: {
          secrets?: Record<string, { hosts: string[]; value: string }>;
        } = {},
      ) => ({
        httpHooks: {},
        env: Object.fromEntries(
          Object.keys(options.secrets ?? {}).map((name) => [
            name,
            `GONDOLIN_SECRET_PLACEHOLDER_${name}`,
          ]),
        ),
        secretManager,
      }),
    ),
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
  loadCredentials,
  resumeVm,
} from './vm-manager.js';

const HOST_ONLY_ENV_NAMES = [
  'MOLTNET_AGENT_KEY',
  'MOLTNET_CLIENT_ID',
  'MOLTNET_CLIENT_SECRET',
  'MOLTNET_CREDENTIALS_PATH',
  'MOLTNET_FINGERPRINT',
  'MOLTNET_PRIVATE_KEY',
  'MOLTNET_PUBLIC_KEY',
  'MOLTNET_GITHUB_APP_PRIVATE_KEY',
  'DATABASE_URL',
] as const;

describe('resumeVm task-context mount', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await gondolinMock.vm.close();
    gondolinMock.resumeCalls.length = 0;
    gondolinMock.vm.exec.mockClear();
    gondolinMock.vm.fs.writeFile.mockClear();
    gondolinMock.vm.close.mockClear();
    gondolinMock.createHttpHooks.mockClear();
    gondolinMock.secretManager.listSecrets.mockClear();
    gondolinMock.secretManager.updateSecret.mockClear();
    gondolinMock.secretManager.deleteSecret.mockClear();
    delete process.env.TEST_FORWARD_ME;
    delete process.env.TEST_DO_NOT_FORWARD;
    for (const name of HOST_ONLY_ENV_NAMES) delete process.env[name];
    delete process.env.MOLTNET_API_URL;
    delete process.env.OLLAMA_API_KEY;
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
    expect(resumeOptions.vfs.mounts[workspace]).toBeInstanceOf(
      gondolinMock.ShadowProvider,
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
    process.env.TEST_FORWARD_ME = 'forwarded';
    process.env.TEST_DO_NOT_FORWARD = 'host-only';

    await resumeVm({
      checkpointPath: path.join(root, 'checkpoint.qcow2'),
      agentName: 'legreffier',
      agentRootDir: root,
      mountPath: workspace,
      forwardEnv: ['TEST_FORWARD_ME'],
      sandboxConfig: {
        env: { NODE_OPTIONS: '--dns-result-order=ipv4first' },
      },
    });

    expect(gondolinMock.resumeCalls).toHaveLength(1);
    const resumeOptions = gondolinMock.resumeCalls[0] as {
      env: Record<string, string>;
    };
    expect(resumeOptions.env.TEST_FORWARD_ME).toBe('forwarded');
    expect(resumeOptions.env.TEST_DO_NOT_FORWARD).toBeUndefined();
    expect(resumeOptions.env.NODE_OPTIONS).toBe('--dns-result-order=ipv4first');
  });

  it('delivers only a destination-bound placeholder to the guest', async () => {
    const root = mkdtempSync(
      path.join(tmpdir(), 'moltnet-vm-brokered-secret-'),
    );
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const sentinel = 'host-only-synthetic-value';
    const diagnostics: unknown[] = [];

    const managed = await resumeVm({
      checkpointPath: path.join(root, 'checkpoint.qcow2'),
      agentName: 'configless',
      agentRootDir: root,
      guestCredentialMode: 'host-authenticated',
      mountPath: workspace,
      sandboxConfig: {
        network: { allowedHosts: ['api.example.com'] },
      },
      brokeredSecrets: [
        {
          id: 'example-api',
          guestEnv: 'EXAMPLE_API_TOKEN',
          hosts: ['api.example.com'],
          value: sentinel,
        },
      ],
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(gondolinMock.createHttpHooks).toHaveBeenCalledWith(
      expect.objectContaining({
        secrets: {
          EXAMPLE_API_TOKEN: {
            hosts: ['api.example.com'],
            value: sentinel,
          },
        },
      }),
    );
    const resumeOptions = gondolinMock.resumeCalls[0] as {
      env: Record<string, string>;
    };
    expect(resumeOptions.env.EXAMPLE_API_TOKEN).toBe(
      'GONDOLIN_SECRET_PLACEHOLDER_EXAMPLE_API_TOKEN',
    );
    expect(resumeOptions.env.EXAMPLE_API_TOKEN).not.toBe(sentinel);
    expect(JSON.stringify(resumeOptions)).not.toContain(sentinel);
    expect(JSON.stringify(diagnostics)).not.toContain(sentinel);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'vm.http_secrets.bound',
          brokeredSecretCount: 1,
        }),
      ]),
    );
    expect(managed.secretManager).toBe(gondolinMock.secretManager);
  });

  it('rejects a secret destination outside network policy before VM resume', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-secret-denied-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });

    await expect(
      resumeVm({
        checkpointPath: path.join(root, 'checkpoint.qcow2'),
        agentName: 'configless',
        agentRootDir: root,
        guestCredentialMode: 'host-authenticated',
        mountPath: workspace,
        sandboxConfig: {
          network: { allowedHosts: ['api.example.com'] },
        },
        brokeredSecrets: [
          {
            id: 'other-api',
            guestEnv: 'OTHER_API_TOKEN',
            hosts: ['other.example.com'],
            value: 'host-only-synthetic-value',
          },
        ],
      }),
    ).rejects.toThrow(/outside the effective network policy/);
    expect(gondolinMock.createHttpHooks).not.toHaveBeenCalled();
    expect(gondolinMock.resumeCalls).toHaveLength(0);
  });

  it.each(HOST_ONLY_ENV_NAMES)(
    'refuses host env %s outside the local guest allowlist',
    async (name) => {
      const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-refused-env-'));
      tempRoots.push(root);
      const workspace = path.join(root, 'workspace');
      mkdirSync(workspace, { recursive: true });
      process.env[name] = 'must-not-enter-guest';

      await expect(
        resumeVm({
          checkpointPath: path.join(root, 'checkpoint.qcow2'),
          agentName: 'configless',
          agentRootDir: root,
          guestCredentialMode: 'host-authenticated',
          mountPath: workspace,
          forwardEnv: [name],
        }),
      ).rejects.toThrow(name);
      expect(gondolinMock.resumeCalls).toHaveLength(0);
    },
  );

  it('rejects MoltNet variables supplied through sandbox overrides', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-configless-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });

    await expect(
      resumeVm({
        checkpointPath: path.join(root, 'checkpoint.qcow2'),
        agentName: 'configless',
        agentRootDir: root,
        guestCredentialMode: 'host-authenticated',
        mountPath: workspace,
        sandboxConfig: {
          env: { MOLTNET_FUTURE_SECRET: 'must-not-enter-guest' },
        },
      }),
    ).rejects.toThrow('MOLTNET_FUTURE_SECRET');
    expect(gondolinMock.resumeCalls).toHaveLength(0);
  });

  it.each(['PATH', 'HOME', 'NODE_EXTRA_CA_CERTS', 'GIT_SSH_COMMAND'])(
    'rejects runtime control variable %s from sandbox overrides in every mode',
    async (name) => {
      const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-control-env-'));
      tempRoots.push(root);
      const workspace = path.join(root, 'workspace');
      const agentDir = path.join(root, '.moltnet', 'legreffier');
      mkdirSync(workspace, { recursive: true });
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        path.join(agentDir, 'moltnet.json'),
        JSON.stringify({ endpoints: { api: 'https://api.themolt.net' } }),
      );
      writeFileSync(path.join(agentDir, 'env'), '');

      await expect(
        resumeVm({
          checkpointPath: path.join(root, 'checkpoint.qcow2'),
          agentName: 'legreffier',
          agentRootDir: root,
          mountPath: workspace,
          sandboxConfig: { env: { [name]: 'override' } },
        }),
      ).rejects.toThrow(name);
      expect(gondolinMock.resumeCalls).toHaveLength(0);
    },
  );

  it('injects only allowlisted model env and no agent files in host-authenticated mode', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-host-auth-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const agentDir = path.join(root, '.moltnet', 'legacy');
    const sshDir = path.join(agentDir, 'ssh');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(
      path.join(agentDir, 'moltnet.json'),
      JSON.stringify({
        endpoints: { api: 'https://must-not-be-read.invalid' },
        oauth2: { client_secret: 'oauth-secret' },
        github: { private_key_path: path.join(agentDir, 'github.pem') },
      }),
      'utf8',
    );
    writeFileSync(
      path.join(agentDir, 'env'),
      'MOLTNET_AGENT_KEY=agent-key-secret\n',
      'utf8',
    );
    writeFileSync(path.join(agentDir, 'gitconfig'), '[user]\nname = Agent\n');
    writeFileSync(path.join(sshDir, 'id_ed25519'), 'signing-private-key');
    writeFileSync(path.join(sshDir, 'id_ed25519.pub'), 'signing-public-key');
    writeFileSync(path.join(sshDir, 'allowed_signers'), 'allowed-signers');
    writeFileSync(path.join(agentDir, 'github.pem'), 'github-app-private-key');
    process.env.OLLAMA_API_KEY = 'model-secret';

    await resumeVm({
      checkpointPath: path.join(root, 'checkpoint.qcow2'),
      agentName: 'legacy',
      agentRootDir: root,
      guestCredentialMode: 'host-authenticated',
      mountPath: workspace,
      forwardEnv: ['OLLAMA_API_KEY'],
    });

    const resumeOptions = gondolinMock.resumeCalls[0] as {
      env: Record<string, string>;
    };
    expect(resumeOptions.env.OLLAMA_API_KEY).toBe('model-secret');
    const writtenPaths = gondolinMock.vm.fs.writeFile.mock.calls.map(
      ([filePath]) => String(filePath),
    );
    expect(writtenPaths).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('/home/agent/.moltnet/'),
      ]),
    );
    expect(
      (gondolinMock.vm.exec.mock.calls as unknown[][]).map(([command]) =>
        String(command),
      ),
    ).not.toEqual(
      expect.arrayContaining([expect.stringContaining('.moltnet')]),
    );

    const workspaceProvider = (
      gondolinMock.resumeCalls[0] as {
        vfs: { mounts: Record<string, unknown> };
      }
    ).vfs.mounts[workspace] as {
      options: {
        denySymlinkBypass: boolean;
        writeMode: string;
        shouldShadow: (ctx: { path: string }) => boolean;
      };
    };
    expect(workspaceProvider.options.writeMode).toBe('deny');
    expect(workspaceProvider.options.denySymlinkBypass).toBe(true);
    expect(
      workspaceProvider.options.shouldShadow({
        path: '/.moltnet/legacy/moltnet.json',
      }),
    ).toBe(true);
    expect(
      workspaceProvider.options.shouldShadow({
        path: '/nested/.moltnet/legacy/env',
      }),
    ).toBe(true);
    expect(
      workspaceProvider.options.shouldShadow({ path: '/src/index.ts' }),
    ).toBe(false);
  });

  it('injects the complete credential tree after explicit guest-config selection', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-guest-config-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const agentDir = path.join(root, '.moltnet', 'legacy');
    const sshDir = path.join(agentDir, 'ssh');
    const pemPath = path.join(agentDir, 'github-app.pem');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(
      path.join(agentDir, 'moltnet.json'),
      JSON.stringify({
        endpoints: { api: 'https://api.themolt.net' },
        github: { private_key_path: pemPath },
      }),
    );
    writeFileSync(path.join(agentDir, 'env'), 'OPENAI_API_KEY=model-secret\n');
    writeFileSync(path.join(agentDir, 'gitconfig'), '[user]\nname = Agent\n');
    writeFileSync(path.join(sshDir, 'id_ed25519'), 'private-key');
    writeFileSync(path.join(sshDir, 'id_ed25519.pub'), 'public-key');
    writeFileSync(path.join(sshDir, 'allowed_signers'), 'allowed-signers');
    writeFileSync(pemPath, 'github-app-pem');

    await resumeVm({
      checkpointPath: path.join(root, 'checkpoint.qcow2'),
      agentName: 'legacy',
      agentRootDir: root,
      guestCredentialMode: 'guest-config',
      mountPath: workspace,
    });

    const writtenPaths = gondolinMock.vm.fs.writeFile.mock.calls.map(
      ([filePath]) => String(filePath),
    );
    expect(writtenPaths).toEqual(
      expect.arrayContaining([
        '/home/agent/.moltnet/legacy/moltnet.json',
        '/home/agent/.moltnet/legacy/env',
        '/home/agent/.moltnet/legacy/gitconfig',
        '/home/agent/.moltnet/legacy/ssh/id_ed25519',
        '/home/agent/.moltnet/legacy/ssh/id_ed25519.pub',
        '/home/agent/.moltnet/legacy/ssh/allowed_signers',
        '/home/agent/.moltnet/legacy/github-app.pem',
      ]),
    );
  });

  it('ignores existing API credential files in host-authenticated mode', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-host-auth-'));
    tempRoots.push(root);
    const agentDir = path.join(root, '.moltnet', 'legacy');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      path.join(agentDir, 'moltnet.json'),
      JSON.stringify({
        oauth2: { client_secret: 'must-not-enter-guest' },
        keys: { private_key: 'must-not-enter-guest' },
      }),
      'utf8',
    );
    writeFileSync(
      path.join(agentDir, 'env'),
      'MOLTNET_AGENT_KEY=must-not-enter-guest\n',
      'utf8',
    );

    const credentials = loadCredentials(agentDir, 'host-authenticated');

    expect(credentials.moltnetJson).toBe('');
    expect(credentials.agentEnvRaw).toBe('');
    expect(credentials.agentEnv).toEqual({});
    expect(credentials.gitconfig).toBeNull();
    expect(credentials.sshPrivateKey).toBeNull();
    expect(credentials.sshPublicKey).toBeNull();
    expect(credentials.allowedSigners).toBeNull();
    expect(credentials.githubAppPem).toBeNull();
  });

  it('keeps agent files required by default', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-required-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });

    await expect(
      resumeVm({
        checkpointPath: path.join(root, 'checkpoint.qcow2'),
        agentName: 'missing',
        agentRootDir: root,
        mountPath: workspace,
      }),
    ).rejects.toThrow('Agent directory not found');
    expect(gondolinMock.resumeCalls).toHaveLength(0);
  });

  it('keeps ordinary, internal, and legacy network grants separate', async () => {
    // Arrange
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-network-'));
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

    // Act
    await resumeVm({
      checkpointPath: path.join(root, 'checkpoint.qcow2'),
      agentName: 'legreffier',
      agentRootDir: root,
      mountPath: workspace,
      extraAllowedHosts: ['legacy-api.example.com'],
      sandboxConfig: {
        network: {
          allowedHosts: ['api.example.com', '*.example.com'],
          allowedInternalHosts: ['onboard-api.internal'],
        },
      },
    });

    // Assert
    expect(gondolinMock.createHttpHooks).toHaveBeenCalledWith({
      allowedHosts: expect.arrayContaining([
        'api.themolt.net',
        'api.example.com',
        '*.example.com',
        'legacy-api.example.com',
      ]),
      allowedInternalHosts: ['onboard-api.internal'],
    });
  });

  it('protects the env-configured MoltNet API host without guest config', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-api-host-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    process.env.MOLTNET_API_URL = 'https://api.local.example';

    await expect(
      resumeVm({
        checkpointPath: path.join(root, 'checkpoint.qcow2'),
        agentName: 'configless',
        agentRootDir: root,
        guestCredentialMode: 'host-authenticated',
        mountPath: workspace,
        sandboxConfig: {
          network: { allowedInternalHosts: ['*.local.example'] },
        },
      }),
    ).rejects.toThrow(
      'pattern "*.local.example" overlaps external-only host pattern "api.local.example"',
    );
    expect(gondolinMock.createHttpHooks).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'immutable base wildcard',
      internalHost: '*.sub.openai.com',
      extraAllowedHosts: undefined,
      protectedHost: '*.openai.com',
    },
    {
      label: 'configured API hostname',
      internalHost: '*.themolt.net',
      extraAllowedHosts: undefined,
      protectedHost: 'api.themolt.net',
    },
    {
      label: 'legacy external hostname',
      internalHost: '*.legacy.example.com',
      extraAllowedHosts: ['api.legacy.example.com'],
      protectedHost: 'api.legacy.example.com',
    },
  ])(
    'rejects an internal wildcard overlapping a $label',
    async ({ internalHost, extraAllowedHosts, protectedHost }) => {
      // Arrange
      const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-overlap-'));
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

      // Act
      const resume = resumeVm({
        checkpointPath: path.join(root, 'checkpoint.qcow2'),
        agentName: 'legreffier',
        agentRootDir: root,
        mountPath: workspace,
        extraAllowedHosts,
        sandboxConfig: {
          network: { allowedInternalHosts: [internalHost] },
        },
      });

      // Assert
      await expect(resume).rejects.toThrow(
        `pattern "${internalHost}" overlaps external-only host pattern "${protectedHost}"`,
      );
      expect(gondolinMock.createHttpHooks).not.toHaveBeenCalled();
    },
  );

  it('shadows future node_modules paths before resume commands run', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-node-modules-'));
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
      workspaceMode: 'dedicated_worktree',
      sandboxConfig: {
        resumeCommands: [
          {
            run: 'cd "$MOLTNET_GUEST_WORKSPACE" && pnpm fetch --frozen-lockfile',
            when: { workspaceMode: ['dedicated_worktree'] },
          },
        ],
      },
    });

    const resumeOptions = gondolinMock.resumeCalls[0] as {
      vfs: { mounts: Record<string, unknown> };
    };
    const workspaceProvider = resumeOptions.vfs.mounts[workspace] as {
      options: {
        denySymlinkBypass: boolean;
        shouldShadow: (ctx: { path: string }) => boolean;
      };
    };
    expect(workspaceProvider).toBeInstanceOf(gondolinMock.ShadowProvider);
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
  });

  it('keeps caller-provided deny shadows authoritative over built-in node_modules memory', async () => {
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
  });
});
