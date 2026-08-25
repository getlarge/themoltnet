/**
 * Unit tests for vm-manager helpers:
 *   - rewriteMoltnetJsonPaths: portability of host-absolute paths into VM
 *   - loadCredentials: PEM reading and filename extraction
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { RealFSProvider, ShadowProvider } from '@earendil-works/gondolin';
import { describe, expect, it, vi } from 'vitest';

import {
  AutoParentMemoryProvider,
  loadCredentials,
  resolveVfsShadowConfig,
  resolveVmAgentDir,
  rewriteGitconfigPaths,
  rewriteMoltnetJsonPaths,
  shouldRunResumeCommand,
  shouldShadowNodeModulesPath,
} from './vm-manager.js';
describe('resolveVfsShadowConfig', () => {
  it('matches VM defaults for configured and absent shadows', () => {
    expect(resolveVfsShadowConfig(undefined)).toEqual({
      mode: 'none',
      patterns: [],
    });
    expect(resolveVfsShadowConfig({ vfs: { shadow: ['.env*'] } })).toEqual({
      mode: 'tmpfs',
      patterns: ['.env*'],
    });
    expect(
      resolveVfsShadowConfig({
        vfs: { shadow: ['.env*'], shadowMode: 'deny' },
      }),
    ).toEqual({
      mode: 'deny',
      patterns: ['.env*'],
    });
  });
});

// ---------------------------------------------------------------------------
// rewriteMoltnetJsonPaths
// ---------------------------------------------------------------------------

describe('rewriteMoltnetJsonPaths', () => {
  const vmAgentDir = '/home/agent/.moltnet/legreffier';
  const vmSshDir = `${vmAgentDir}/ssh`;

  it('rewrites ssh paths to VM-local equivalents, preserving basename', () => {
    const input = JSON.stringify({
      identity_id: 'abc',
      ssh: {
        private_key_path: '/Users/ed/.moltnet/legreffier/ssh/id_ed25519',
        public_key_path: '/Users/ed/.moltnet/legreffier/ssh/id_ed25519.pub',
      },
    });

    const output = JSON.parse(
      rewriteMoltnetJsonPaths(input, vmAgentDir, vmSshDir, null),
    );

    expect(output.ssh.private_key_path).toBe(`${vmSshDir}/id_ed25519`);
    expect(output.ssh.public_key_path).toBe(`${vmSshDir}/id_ed25519.pub`);
    expect(output.identity_id).toBe('abc');
  });

  it('preserves custom SSH key basename (e.g. id_ecdsa)', () => {
    const input = JSON.stringify({
      ssh: {
        private_key_path: '/Users/ed/.moltnet/myagent/ssh/id_ecdsa',
        public_key_path: '/Users/ed/.moltnet/myagent/ssh/id_ecdsa.pub',
      },
    });

    const output = JSON.parse(
      rewriteMoltnetJsonPaths(input, vmAgentDir, vmSshDir, null),
    );

    expect(output.ssh.private_key_path).toBe(`${vmSshDir}/id_ecdsa`);
    expect(output.ssh.public_key_path).toBe(`${vmSshDir}/id_ecdsa.pub`);
  });

  it('rewrites git.config_path to VM-local gitconfig', () => {
    const input = JSON.stringify({
      git: {
        name: 'LeGreffier',
        config_path: '/Users/ed/.moltnet/legreffier/gitconfig',
      },
    });

    const output = JSON.parse(
      rewriteMoltnetJsonPaths(input, vmAgentDir, vmSshDir, null),
    );

    expect(output.git.config_path).toBe(`${vmAgentDir}/gitconfig`);
    expect(output.git.name).toBe('LeGreffier');
  });

  it('rewrites github.private_key_path when pemFilename is provided', () => {
    const input = JSON.stringify({
      github: {
        app_id: '123',
        private_key_path: '/Users/ed/.moltnet/legreffier/legreffier.pem',
      },
    });

    const output = JSON.parse(
      rewriteMoltnetJsonPaths(input, vmAgentDir, vmSshDir, 'legreffier.pem'),
    );

    expect(output.github.private_key_path).toBe(`${vmAgentDir}/legreffier.pem`);
    expect(output.github.app_id).toBe('123');
  });

  it('leaves github.private_key_path unchanged when pemFilename is null', () => {
    const hostPemPath = '/Users/ed/.moltnet/legreffier/legreffier.pem';
    const input = JSON.stringify({
      github: {
        app_id: '123',
        private_key_path: hostPemPath,
      },
    });

    const output = JSON.parse(
      rewriteMoltnetJsonPaths(input, vmAgentDir, vmSshDir, null),
    );

    expect(output.github.private_key_path).toBe(hostPemPath);
  });

  it('passes through fields with no path semantics unchanged', () => {
    const input = JSON.stringify({
      identity_id: 'xyz',
      oauth2: { client_id: 'cid', client_secret: 'sec' },
      endpoints: { api: 'https://api.themolt.net' },
      registered_at: '2026-01-01T00:00:00Z',
    });

    const output = JSON.parse(
      rewriteMoltnetJsonPaths(input, vmAgentDir, vmSshDir, null),
    );

    expect(output.identity_id).toBe('xyz');
    expect(output.oauth2).toEqual({ client_id: 'cid', client_secret: 'sec' });
    expect(output.endpoints.api).toBe('https://api.themolt.net');
  });

  it('throws if moltnetJson is not valid JSON', () => {
    expect(() =>
      rewriteMoltnetJsonPaths('not json {{{', vmAgentDir, vmSshDir, null),
    ).toThrow();
  });

  it('handles a full moltnet.json fixture end-to-end', () => {
    const input = JSON.stringify({
      identity_id: 'a854b555',
      oauth2: { client_id: 'cid', client_secret: 'sec' },
      keys: 'ed25519:abc=',
      endpoints: {
        api: 'https://api.themolt.net',
        mcp: 'https://mcp.themolt.net/mcp',
      },
      registered_at: '2026-02-13T22:34:48Z',
      ssh: {
        private_key_path: '/Users/ed/.moltnet/legreffier/ssh/id_ed25519',
        public_key_path: '/Users/ed/.moltnet/legreffier/ssh/id_ed25519.pub',
      },
      git: {
        name: 'LeGreffier',
        email: '261968324+legreffier[bot]@users.noreply.github.com',
        signing: true,
        config_path: '/Users/ed/.moltnet/legreffier/gitconfig',
      },
      github: {
        app_id: '2878569',
        app_slug: 'legreffier',
        installation_id: '110518607',
        private_key_path: '/Users/ed/.moltnet/legreffier/legreffier.pem',
      },
    });

    const output = JSON.parse(
      rewriteMoltnetJsonPaths(input, vmAgentDir, vmSshDir, 'legreffier.pem'),
    );

    // Paths rewritten
    expect(output.ssh.private_key_path).toBe(`${vmSshDir}/id_ed25519`);
    expect(output.ssh.public_key_path).toBe(`${vmSshDir}/id_ed25519.pub`);
    expect(output.git.config_path).toBe(`${vmAgentDir}/gitconfig`);
    expect(output.github.private_key_path).toBe(`${vmAgentDir}/legreffier.pem`);

    // Non-path fields preserved
    expect(output.identity_id).toBe('a854b555');
    expect(output.git.email).toBe(
      '261968324+legreffier[bot]@users.noreply.github.com',
    );
    expect(output.github.app_id).toBe('2878569');
    expect(output.github.installation_id).toBe('110518607');
  });
});

describe('rewriteGitconfigPaths', () => {
  const vmAgentDir = '/home/agent/.moltnet/legreffier';
  const vmSshDir = `${vmAgentDir}/ssh`;

  it('rewrites signingKey to the VM-side ssh key path', () => {
    const input = [
      '[gpg "ssh"]',
      '\tsigningKey = /Users/ed/.moltnet/legreffier/ssh/id_ed25519',
    ].join('\n');
    const out = rewriteGitconfigPaths(input, vmSshDir, vmAgentDir);
    expect(out).toContain(`signingKey = ${vmSshDir}/id_ed25519`);
    expect(out).not.toContain('/Users/ed/');
  });

  it('rewrites the credential-helper --credentials path to VM-side moltnet.json', () => {
    const input = [
      '[credential "https://github.com"]',
      '\thelper = "!moltnet github credential-helper --credentials /Users/ed/.moltnet/legreffier/moltnet.json"',
      '[url "https://github.com/"]',
      '\tinsteadOf = git@github.com:',
    ].join('\n');
    const out = rewriteGitconfigPaths(input, vmSshDir, vmAgentDir);
    expect(out).toContain(
      `moltnet github credential-helper --credentials ${vmAgentDir}/moltnet.json`,
    );
    expect(out).not.toContain('/Users/ed/');
    // insteadOf rule is workspace-independent and must be preserved verbatim.
    expect(out).toContain('insteadOf = git@github.com:');
  });

  it('preserves the empty helper-reset line verbatim', () => {
    const input = [
      '[credential "https://github.com"]',
      '\thelper = ""',
      '\thelper = "!moltnet github credential-helper --credentials /Users/ed/.moltnet/legreffier/moltnet.json"',
    ].join('\n');
    const out = rewriteGitconfigPaths(input, vmSshDir, vmAgentDir);
    // The reset line must survive the rewrite unchanged and still precede the
    // real helper, so the agent helper stays authoritative in the guest too.
    expect(out).toContain('helper = ""');
    expect(out.indexOf('helper = ""')).toBeLessThan(
      out.indexOf('credential-helper'),
    );
    expect(out).toContain(
      `moltnet github credential-helper --credentials ${vmAgentDir}/moltnet.json`,
    );
  });

  it('leaves a gitconfig without credential helper unchanged except signingKey', () => {
    const input = [
      '[user]',
      '\tname = LeGreffier',
      '[gpg "ssh"]',
      '\tsigningKey = /Users/ed/.moltnet/legreffier/ssh/id_ed25519',
    ].join('\n');
    const out = rewriteGitconfigPaths(input, vmSshDir, vmAgentDir);
    expect(out).toContain('name = LeGreffier');
    expect(out).toContain(`signingKey = ${vmSshDir}/id_ed25519`);
    expect(out).not.toContain('credential-helper');
  });
});

describe('resolveVmAgentDir', () => {
  it('uses the explicit agent root without touching git discovery', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'pi-agent-root-'));
    try {
      expect(
        resolveVmAgentDir({
          agentName: 'legreffier',
          agentRootDir: rootDir,
        }),
      ).toBe(path.join(rootDir, '.moltnet', 'legreffier'));
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('shouldRunResumeCommand', () => {
  it('always runs raw string commands', () => {
    expect(
      shouldRunResumeCommand('corepack enable', {
        workspaceMode: 'scratch_mount',
      }),
    ).toBe(true);
  });

  it('runs object commands when no predicate is present', () => {
    expect(
      shouldRunResumeCommand(
        { run: 'pnpm install --frozen-lockfile' },
        { workspaceMode: 'scratch_mount' },
      ),
    ).toBe(true);
  });

  it('runs commands when workspaceMode matches the predicate', () => {
    expect(
      shouldRunResumeCommand(
        {
          run: 'pnpm install --frozen-lockfile',
          when: {
            workspaceMode: ['shared_mount', 'dedicated_worktree'],
          },
        },
        { workspaceMode: 'shared_mount' },
      ),
    ).toBe(true);
  });

  it('skips commands when workspaceMode does not match the predicate', () => {
    expect(
      shouldRunResumeCommand(
        {
          run: 'pnpm install --frozen-lockfile',
          when: {
            workspaceMode: ['shared_mount', 'dedicated_worktree'],
          },
        },
        { workspaceMode: 'scratch_mount' },
      ),
    ).toBe(false);
  });
});

describe('node_modules VM-local shadowing', () => {
  it('matches any current or future node_modules segment', () => {
    expect(shouldShadowNodeModulesPath('/node_modules')).toBe(true);
    expect(shouldShadowNodeModulesPath('/apps/api/node_modules')).toBe(true);
    expect(
      shouldShadowNodeModulesPath(
        '/.worktrees/task-1/packages/web/node_modules/.bin/vite',
      ),
    ).toBe(true);
    expect(shouldShadowNodeModulesPath('/src/node_modules_fixture')).toBe(
      false,
    );
    expect(shouldShadowNodeModulesPath('/packages/node_modules-old')).toBe(
      false,
    );
  });

  it('routes future node_modules writes to memory with executable .bin shims', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pi-node-modules-vfs-'));
    try {
      mkdirSync(path.join(root, 'node_modules', 'host-only'), {
        recursive: true,
      });
      writeFileSync(
        path.join(root, 'node_modules', 'host-only', 'index.js'),
        'host dependency',
      );

      const provider = new ShadowProvider(new RealFSProvider(root), {
        shouldShadow: ({ path: shadowPath }) =>
          shouldShadowNodeModulesPath(shadowPath),
        tmpfs: new AutoParentMemoryProvider(),
        writeMode: 'tmpfs',
      });

      expect(() =>
        provider.statSync('/node_modules/host-only/index.js'),
      ).toThrow();

      const guestTool = '/.worktrees/later/packages/web/node_modules/.bin/vite';
      const nodeModulesHandle = provider.openSync(guestTool, 'w');
      nodeModulesHandle.writeFileSync('guest tool');
      nodeModulesHandle.closeSync();

      expect(
        existsSync(
          path.join(root, '.worktrees/later/packages/web/node_modules'),
        ),
      ).toBe(false);
      expect(provider.openSync(guestTool, 'r').readFileSync('utf8')).toBe(
        'guest tool',
      );
      expect(provider.statSync(guestTool).mode & 0o111).not.toBe(0);

      mkdirSync(path.join(root, '.worktrees/later/packages/web/src'), {
        recursive: true,
      });
      const sourceFile = '/.worktrees/later/packages/web/src/index.ts';
      const sourceHandle = provider.openSync(sourceFile, 'w');
      sourceHandle.writeFileSync('export const ok = true;');
      sourceHandle.closeSync();

      expect(
        readFileSync(
          path.join(root, '.worktrees/later/packages/web/src/index.ts'),
          'utf8',
        ),
      ).toBe('export const ok = true;');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// loadCredentials — PEM reading (finding 7)
// ---------------------------------------------------------------------------

describe('loadCredentials PEM reading', () => {
  function makeAgentDir(opts: {
    pemContent?: string;
    pemFilename?: string;
    moltnetJsonGithub?: object | null;
  }): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'pi-test-'));

    // Minimal moltnet.json
    const github =
      opts.moltnetJsonGithub !== undefined
        ? opts.moltnetJsonGithub
        : opts.pemFilename
          ? {
              app_id: '123',
              private_key_path: path.join(dir, opts.pemFilename),
            }
          : undefined;
    writeFileSync(
      path.join(dir, 'moltnet.json'),
      JSON.stringify({
        identity_id: 'test',
        endpoints: { api: 'https://api.themolt.net' },
        ...(github !== null && github !== undefined ? { github } : {}),
      }),
    );
    writeFileSync(path.join(dir, 'env'), 'MOLTNET_AGENT_NAME=test\n');

    if (opts.pemContent && opts.pemFilename) {
      writeFileSync(path.join(dir, opts.pemFilename), opts.pemContent);
    }

    // Minimal SSH dir (loadCredentials won't throw if files are absent)
    mkdirSync(path.join(dir, 'ssh'), { recursive: true });

    return dir;
  }

  it('loads PEM content and filename when configured and file exists', () => {
    const dir = makeAgentDir({
      pemContent:
        '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n',
      pemFilename: 'app.pem',
    });
    try {
      // loadCredentials requires pi auth.json; stub HOME to a temp dir
      const oldHome = process.env.HOME;
      const fakeHome = mkdtempSync(path.join(tmpdir(), 'pi-home-'));
      mkdirSync(path.join(fakeHome, '.pi', 'agent'), { recursive: true });
      writeFileSync(
        path.join(fakeHome, '.pi', 'agent', 'auth.json'),
        JSON.stringify({ token: 'fake' }),
      );
      process.env.HOME = fakeHome;
      try {
        const creds = loadCredentials(dir);
        expect(creds.githubAppPem).toContain('BEGIN RSA PRIVATE KEY');
        expect(creds.githubAppPemFilename).toBe('app.pem');
      } finally {
        process.env.HOME = oldHome;
        rmSync(fakeHome, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sets githubAppPem/Filename to null when no github config in moltnet.json', () => {
    const dir = makeAgentDir({ moltnetJsonGithub: null });
    const oldHome = process.env.HOME;
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'pi-home-'));
    mkdirSync(path.join(fakeHome, '.pi', 'agent'), { recursive: true });
    writeFileSync(
      path.join(fakeHome, '.pi', 'agent', 'auth.json'),
      JSON.stringify({ token: 'fake' }),
    );
    process.env.HOME = fakeHome;
    try {
      const creds = loadCredentials(dir);
      expect(creds.githubAppPem).toBeNull();
      expect(creds.githubAppPemFilename).toBeNull();
    } finally {
      process.env.HOME = oldHome;
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a structured diagnostic when the GitHub PEM is missing', () => {
    const missingPemPath = path.join(tmpdir(), 'nonexistent-pem-sentinel.pem');
    const dir = makeAgentDir({
      moltnetJsonGithub: {
        app_id: '123',
        private_key_path: missingPemPath,
      },
    });
    const oldHome = process.env.HOME;
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'pi-home-'));
    mkdirSync(path.join(fakeHome, '.pi', 'agent'), { recursive: true });
    writeFileSync(
      path.join(fakeHome, '.pi', 'agent', 'auth.json'),
      JSON.stringify({ token: 'fake' }),
    );
    process.env.HOME = fakeHome;
    const onDiagnostic = vi.fn();
    try {
      const creds = loadCredentials(dir, 'guest-config', onDiagnostic);
      expect(creds.githubAppPem).toBeNull();
      expect(onDiagnostic).toHaveBeenCalledWith({
        event: 'vm.credentials.github_key_missing',
        level: 'warning',
        credentialMode: 'guest-config',
        message: expect.stringContaining('nonexistent-pem-sentinel'),
      });
    } finally {
      process.env.HOME = oldHome;
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
