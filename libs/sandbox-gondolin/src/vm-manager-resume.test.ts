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
          isRequestAllowed?: (request: Request) => boolean;
          onRequest?: (request: Request) => Promise<Response | void>;
          allowedInternalHosts?: string[];
          isIpAllowed?: (info: {
            hostname: string;
            ip: string;
            family: 4 | 6;
            port: number;
            protocol: 'http' | 'https';
          }) => boolean;
        } = {},
      ) => ({
        httpHooks: {
          isRequestAllowed: options.isRequestAllowed,
          onRequest: options.onRequest,
          isIpAllowed: options.isIpAllowed,
        },
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
  resumeVm,
  type VmDiagnostic,
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
    delete process.env.ANTHROPIC_API_KEY;
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
    // Under the single host-authenticated boundary, forwardEnv accepts only
    // allowlisted provider vars; anything else is refused.
    process.env.ANTHROPIC_API_KEY = 'forwarded';
    process.env.TEST_DO_NOT_FORWARD = 'host-only';

    await resumeVm({
      checkpointPath: path.join(root, 'checkpoint.qcow2'),
      agentName: 'legreffier',
      agentRootDir: root,
      mountPath: workspace,
      forwardEnv: ['ANTHROPIC_API_KEY'],
      sandboxConfig: {
        env: { NODE_OPTIONS: '--dns-result-order=ipv4first' },
      },
    });

    expect(gondolinMock.resumeCalls).toHaveLength(1);
    const resumeOptions = gondolinMock.resumeCalls[0] as {
      env: Record<string, string>;
    };
    expect(resumeOptions.env.ANTHROPIC_API_KEY).toBe('forwarded');
    expect(resumeOptions.env.TEST_DO_NOT_FORWARD).toBeUndefined();
    expect(resumeOptions.env.NODE_OPTIONS).toBe('--dns-result-order=ipv4first');
  });

  it('refuses a non-allowlisted forwardEnv name regardless of mode', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-env-refuse-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    process.env.TOTALLY_ARBITRARY = 'nope';

    // The host-authenticated allowlist is enforced unconditionally, so a
    // non-provider forward name is refused before the VM is ever resumed —
    // even if a caller still passes the vestigial `guest-config` mode.
    await expect(
      resumeVm({
        checkpointPath: path.join(root, 'checkpoint.qcow2'),
        agentName: 'legreffier',
        agentRootDir: root,
        mountPath: workspace,
        guestCredentialMode: 'guest-config',
        forwardEnv: ['TOTALLY_ARBITRARY'],
      }),
    ).rejects.toThrow(/TOTALLY_ARBITRARY/);
    expect(gondolinMock.resumeCalls).toHaveLength(0);
    delete process.env.TOTALLY_ARBITRARY;
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
    const hookOptions = gondolinMock.createHttpHooks.mock.calls[0]?.[0] as {
      isRequestAllowed: (request: Request) => boolean;
      isIpAllowed: (info: {
        hostname: string;
        ip: string;
        family: 4 | 6;
        port: number;
        protocol: 'http' | 'https';
      }) => boolean;
    };
    expect(
      hookOptions.isRequestAllowed(
        new Request('https://api.example.com/allowed', {
          headers: { authorization: `Bearer ${sentinel}` },
        }),
      ),
    ).toBe(true);
    expect(
      hookOptions.isRequestAllowed(
        new Request('http://api.example.com/downgrade', {
          headers: { authorization: `Bearer ${sentinel}` },
        }),
      ),
    ).toBe(false);
    expect(
      hookOptions.isIpAllowed({
        hostname: 'api.example.com',
        ip: '203.0.113.7',
        family: 4,
        protocol: 'https',
        port: 8443,
      }),
    ).toBe(false);
    expect(
      hookOptions.isRequestAllowed(
        new Request('https://api.example.com:8443/wrong-port', {
          headers: {
            authorization: `Basic ${Buffer.from(
              `x-access-token:${sentinel}`,
            ).toString('base64')}`,
          },
        }),
      ),
    ).toBe(false);
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
    managed.secretManager.rotateSecret('EXAMPLE_API_TOKEN', 'rotated');
    expect(gondolinMock.secretManager.updateSecret).toHaveBeenCalledWith(
      'EXAMPLE_API_TOKEN',
      { value: 'rotated' },
    );
    expect(
      hookOptions.isRequestAllowed(
        new Request('http://api.example.com/downgrade', {
          headers: { authorization: 'Bearer rotated' },
        }),
      ),
    ).toBe(false);
    managed.secretManager.revokeSecret('EXAMPLE_API_TOKEN');
    expect(gondolinMock.secretManager.deleteSecret).toHaveBeenCalledWith(
      'EXAMPLE_API_TOKEN',
    );
    expect(managed.secretManager).not.toHaveProperty('listSecrets');
    expect(managed.secretManager).not.toHaveProperty('updateSecret');
    expect(managed.secretManager).not.toHaveProperty('deleteSecret');
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
    // The outermost layer is the unconditional `.moltnet` deny shadow; the
    // node_modules shadow sits directly beneath it (no VFS shadow configured).
    const moltnetShadow = resumeOptions.vfs.mounts[workspace] as {
      provider: unknown;
    };
    const workspaceProvider = moltnetShadow.provider as {
      options: {
        denySymlinkBypass: boolean;
        shouldShadow: (ctx: { path: string }) => boolean;
      };
    };
    expect(moltnetShadow).toBeInstanceOf(gondolinMock.ShadowProvider);
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
    // Outermost is the unconditional `.moltnet` deny shadow; beneath it the
    // caller's `deny` shadow must stay authoritative over the built-in
    // node_modules tmpfs shadow.
    const moltnetShadow = resumeOptions.vfs.mounts[workspace] as {
      provider: unknown;
      options: { writeMode: string };
    };
    expect(moltnetShadow).toBeInstanceOf(gondolinMock.ShadowProvider);
    expect(moltnetShadow.options.writeMode).toBe('deny');
    const outerProvider = moltnetShadow.provider as {
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
  it('wires host origins into the proxy hook and the internal allowlist', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-host-origins-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const handler = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    const diagnostics: VmDiagnostic[] = [];

    const managed = await resumeVm({
      checkpointPath: path.join(root, 'checkpoint.qcow2'),
      agentName: 'configless',
      agentRootDir: root,
      guestCredentialMode: 'host-authenticated',
      mountPath: workspace,
      hostOrigins: { 'https://agent-signing.moltnet.internal': handler },
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    const hooksCall = gondolinMock.createHttpHooks.mock.calls[0][0] as {
      allowedInternalHosts: string[];
      onRequest: (request: Request) => Promise<Response | void>;
    };
    expect(hooksCall.allowedInternalHosts).toContain(
      'agent-signing.moltnet.internal',
    );
    await expect(
      hooksCall.onRequest(
        new Request('https://agent-signing.moltnet.internal/identity'),
      ),
    ).resolves.toBeInstanceOf(Response);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        event: 'vm.host_origins.bound',
        hostOriginCount: 1,
      }),
    );
    await managed.services.stop();
  });

  it('rejects a host origin that overlaps a protected external host', async () => {
    const root = mkdtempSync(
      path.join(tmpdir(), 'moltnet-vm-host-origins-bad-'),
    );
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
        hostOrigins: {
          'https://api.themolt.net': () =>
            Promise.resolve(new Response('', { status: 200 })),
        },
      }),
    ).rejects.toThrow(/overlaps external-only host pattern/);
    expect(gondolinMock.createHttpHooks).not.toHaveBeenCalled();
  });

  const readinessMock = (async (command: unknown) =>
    Array.isArray(command) &&
    command[0] === 'sh' &&
    command[3] === 'moltnet-readiness'
      ? { exitCode: 1, stdout: '', stderr: '' }
      : { exitCode: 0, stdout: '', stderr: '' }) as never;

  it('fails the session when a required service never becomes ready', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-readiness-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    gondolinMock.vm.exec.mockImplementation(readinessMock);
    await expect(
      resumeVm({
        checkpointPath: path.join(root, 'checkpoint.qcow2'),
        agentName: 'configless',
        agentRootDir: root,
        guestCredentialMode: 'host-authenticated',
        mountPath: workspace,
        guestProjection: {
          services: [
            {
              id: 'critical',
              command: ['true'],
              readiness: {
                path: '/run/x.sock',
                timeoutMs: 300,
                required: true,
              },
            },
          ],
        },
      }),
    ).rejects.toThrow(/did not become ready/);
    expect(gondolinMock.vm.close).toHaveBeenCalled();
  });

  it('degrades but does not fail when a best-effort service never becomes ready', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-readiness-soft-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const diagnostics: VmDiagnostic[] = [];
    gondolinMock.vm.exec.mockImplementation(readinessMock);
    const managed = await resumeVm({
      checkpointPath: path.join(root, 'checkpoint.qcow2'),
      agentName: 'configless',
      agentRootDir: root,
      guestCredentialMode: 'host-authenticated',
      mountPath: workspace,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      guestProjection: {
        services: [
          {
            id: 'signer-agent',
            command: ['true'],
            readiness: { path: '/run/x.sock', timeoutMs: 300 },
          },
        ],
      },
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ event: 'vm.guest_service.not_ready' }),
    );
    expect(gondolinMock.vm.close).not.toHaveBeenCalled();
    await managed.services.stop();
  });

  it('rejects a path-unsafe service id before launching anything', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-bad-service-'));
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
        guestProjection: {
          services: [{ id: '../escape', command: ['true'] }],
        },
      }),
    ).rejects.toThrow(/Invalid guest service id/);
  });

  it('rejects a projected env name that collides with a brokered secret', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-env-collision-'));
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
        sandboxConfig: { network: { allowedHosts: ['api.example.com'] } },
        brokeredSecrets: [
          {
            id: 'api',
            guestEnv: 'MOLTNET_SIGNER_URL',
            hosts: ['api.example.com'],
            value: 'v',
          },
        ],
        guestProjection: { env: { MOLTNET_SIGNER_URL: 'https://x' } },
      }),
    ).rejects.toThrow(/MOLTNET_SIGNER_URL/);
    expect(gondolinMock.createHttpHooks).not.toHaveBeenCalled();
  });

  it('never lets a host-only value reach resume options, diagnostics or the guest projection', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-leak-guard-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const seedSentinel = 'SEED_SENTINEL_never_in_guest';
    const diagnostics: VmDiagnostic[] = [];
    const managed = await resumeVm({
      checkpointPath: path.join(root, 'checkpoint.qcow2'),
      agentName: 'configless',
      agentRootDir: root,
      guestCredentialMode: 'host-authenticated',
      mountPath: workspace,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      hostOrigins: {
        'https://agent-signing.moltnet.internal': () =>
          Promise.resolve(new Response(seedSentinel, { status: 200 })),
      },
      guestProjection: {
        env: { MOLTNET_SIGNER_URL: 'https://agent-signing.moltnet.internal' },
        files: [
          {
            path: '/home/agent/.config/moltnet/gitconfig',
            content:
              '[user]\n\tname = A\n\tsigningKey = key::ssh-ed25519 AAAA\n',
          },
        ],
      },
    });
    const serialized = JSON.stringify({
      resumeOptions: gondolinMock.resumeCalls[0],
      diagnostics,
      files: gondolinMock.vm.fs.writeFile.mock.calls,
    });
    expect(serialized).not.toContain(seedSentinel);
    expect(serialized).not.toMatch(
      /id_ed25519|credential-helper|PRIVATE KEY|moltnet\.json/,
    );
    await managed.services.stop();
  });

  it('projects trusted guest env, files and services and reports value-free diagnostics', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moltnet-vm-projection-'));
    tempRoots.push(root);
    const workspace = path.join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const diagnostics: VmDiagnostic[] = [];

    const managed = await resumeVm({
      checkpointPath: path.join(root, 'checkpoint.qcow2'),
      agentName: 'configless',
      agentRootDir: root,
      guestCredentialMode: 'host-authenticated',
      mountPath: workspace,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      guestProjection: {
        env: {
          MOLTNET_SIGNER_URL: 'https://agent-signing.moltnet.internal',
          SSH_AUTH_SOCK: '/run/moltnet/signer.sock',
        },
        files: [
          {
            path: '/home/agent/.config/moltnet/gitconfig',
            content: '[user]\n\tname = A\n',
            mode: 0o644,
          },
        ],
        services: [
          {
            id: 'signer-agent',
            command: ['moltnet', 'capability', 'serve', 'agent-signing'],
          },
        ],
      },
    });

    const resumeOptions = gondolinMock.resumeCalls[0] as {
      env: Record<string, string>;
    };
    expect(resumeOptions.env.MOLTNET_SIGNER_URL).toBe(
      'https://agent-signing.moltnet.internal',
    );
    expect(resumeOptions.env.SSH_AUTH_SOCK).toBe('/run/moltnet/signer.sock');
    expect(gondolinMock.vm.fs.writeFile).toHaveBeenCalledWith(
      '/home/agent/.config/moltnet/gitconfig',
      '[user]\n\tname = A\n',
      expect.objectContaining({ mode: 0o644 }),
    );
    // mkdir/chmod/chown run through the exit-checking vmRun helper as
    // `['sh','-c', script]`; assert the script content.
    const execScripts = (gondolinMock.vm.exec.mock.calls as unknown[][])
      .map(([command]) => command)
      .filter((command): command is string[] => Array.isArray(command))
      .filter((command) => command[0] === 'sh' && command[1] === '-c')
      .map((command) => command[2] as string);
    expect(
      execScripts.some(
        (script) =>
          script.includes('mkdir -p') &&
          script.includes('/home/agent/.config/moltnet'),
      ),
    ).toBe(true);
    expect(
      execScripts.some(
        (script) =>
          script.includes('chmod 644') &&
          script.includes('/home/agent/.config/moltnet/gitconfig'),
      ),
    ).toBe(true);
    // The chown existence-guards each projected target so an absent dir is
    // skipped instead of aborting VM resume, while a real chown failure on a
    // present dir still surfaces via `set -e`. No provider-auth `.pi` dir is
    // projected any more (the Pi session runs host-side), so it is not chowned.
    const chownScript = execScripts.find((script) =>
      script.includes('chown -R agent:agent'),
    );
    expect(chownScript).toBeDefined();
    expect(chownScript).toContain('set -e');
    expect(chownScript).toContain('if [ -e "$d" ]');
    expect(chownScript).toContain('/home/agent/.config/moltnet');
    expect(chownScript).not.toContain('/home/agent/.pi');
    expect(chownScript).not.toMatch(/chown -R agent:agent [^;]*\|\| true/);
    expect(gondolinMock.vm.exec).toHaveBeenCalledWith(
      expect.arrayContaining([
        'setsid',
        'sh',
        '-c',
        expect.stringContaining('/run/moltnet/services/signer-agent.pid'),
        'moltnet',
        'capability',
        'serve',
        'agent-signing',
      ]),
      expect.objectContaining({ stdout: 'ignore', stderr: 'ignore' }),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        event: 'vm.guest_projection.applied',
        projectedFileCount: 1,
        projectedServiceCount: 1,
      }),
    );
    expect(JSON.stringify(diagnostics)).not.toContain('[user]');
    expect(managed.services).toBeDefined();
    await managed.services.stop();
    const execCommands = (gondolinMock.vm.exec.mock.calls as unknown[][]).map(
      ([command]) => JSON.stringify(command),
    );
    expect(
      execCommands.some(
        (command) =>
          command.includes('signer-agent.pid') && command.includes('kill'),
      ),
    ).toBe(true);
  });
});
