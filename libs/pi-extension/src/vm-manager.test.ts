/**
 * Unit tests for vm-manager helpers:
 *   - rewriteMoltnetJsonPaths: portability of host-absolute paths into VM
 *   - loadCredentials: PEM reading and filename extraction
 *   - ensureRelativeWorktreePaths: gitconfig mutation (pre-existing)
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { prepareTaskWorkspace } from './runtime/task-workspace.js';
import {
  ensureRelativeWorktreePaths,
  loadCredentials,
  rewriteMoltnetJsonPaths,
  shouldRunResumeCommand,
} from './vm-manager.js';

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

  it('sets githubAppPem to null and writes a warning when PEM file is missing', () => {
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
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };
    try {
      const creds = loadCredentials(dir);
      expect(creds.githubAppPem).toBeNull();
      expect(stderrChunks.join('')).toMatch(
        /Warning.*nonexistent-pem-sentinel/,
      );
    } finally {
      process.stderr.write = origWrite;
      process.env.HOME = oldHome;
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// loadCredentials — Pi auth optionality (CI / env-var-only auth)
// ---------------------------------------------------------------------------

describe('loadCredentials Pi auth optionality', () => {
  function makeMinimalAgentDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'pi-noauth-'));
    writeFileSync(
      path.join(dir, 'moltnet.json'),
      JSON.stringify({
        identity_id: 'test',
        endpoints: { api: 'https://api.themolt.net' },
      }),
    );
    writeFileSync(path.join(dir, 'env'), 'MOLTNET_AGENT_NAME=test\n');
    mkdirSync(path.join(dir, 'ssh'), { recursive: true });
    return dir;
  }

  it('returns piAuthJson=null when ~/.pi/agent/auth.json is absent', () => {
    const dir = makeMinimalAgentDir();
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'pi-home-noauth-'));
    const oldHome = process.env.HOME;
    const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.HOME = fakeHome;
    delete process.env.PI_CODING_AGENT_DIR;
    try {
      const creds = loadCredentials(dir);
      expect(creds.piAuthJson).toBeNull();
    } finally {
      process.env.HOME = oldHome;
      if (oldAgentDir !== undefined)
        process.env.PI_CODING_AGENT_DIR = oldAgentDir;
      else delete process.env.PI_CODING_AGENT_DIR;
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honors PI_CODING_AGENT_DIR override when set', () => {
    const dir = makeMinimalAgentDir();
    const altDir = mkdtempSync(path.join(tmpdir(), 'pi-altagent-'));
    mkdirSync(path.join(altDir, '.pi', 'agent'), { recursive: true });
    writeFileSync(
      path.join(altDir, '.pi', 'agent', 'auth.json'),
      '{"anthropic":{"type":"api_key","key":"sk-x"}}',
    );
    const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = path.join(altDir, '.pi', 'agent');
    try {
      const creds = loadCredentials(dir);
      expect(creds.piAuthJson).toContain('sk-x');
    } finally {
      if (oldAgentDir !== undefined)
        process.env.PI_CODING_AGENT_DIR = oldAgentDir;
      else delete process.env.PI_CODING_AGENT_DIR;
      rmSync(altDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still loads default ~/.pi/agent/auth.json when present', () => {
    const dir = makeMinimalAgentDir();
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'pi-home-default-'));
    mkdirSync(path.join(fakeHome, '.pi', 'agent'), { recursive: true });
    writeFileSync(
      path.join(fakeHome, '.pi', 'agent', 'auth.json'),
      '{"openai":{"type":"api_key","key":"sk-default"}}',
    );
    const oldHome = process.env.HOME;
    const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.HOME = fakeHome;
    delete process.env.PI_CODING_AGENT_DIR;
    try {
      const creds = loadCredentials(dir);
      expect(creds.piAuthJson).toContain('sk-default');
    } finally {
      process.env.HOME = oldHome;
      if (oldAgentDir !== undefined)
        process.env.PI_CODING_AGENT_DIR = oldAgentDir;
      else delete process.env.PI_CODING_AGENT_DIR;
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// ensureRelativeWorktreePaths (pre-existing helper, regression guard)
// ---------------------------------------------------------------------------

describe('ensureRelativeWorktreePaths', () => {
  it('appends [worktree] section when absent', () => {
    const gc = '[core]\n\trepositoryformatversion = 0\n';
    const out = ensureRelativeWorktreePaths(gc);
    expect(out).toContain('[worktree]');
    expect(out).toContain('useRelativePaths = true');
  });

  it('adds key when [worktree] section exists without key', () => {
    const gc = '[core]\n\tbare = false\n[worktree]\n';
    const out = ensureRelativeWorktreePaths(gc);
    expect(out).toContain('useRelativePaths = true');
    // should not duplicate the section header
    expect((out.match(/\[worktree\]/g) ?? []).length).toBe(1);
  });

  it('rewrites existing useRelativePaths value to true', () => {
    const gc = '[worktree]\n\tuseRelativePaths = false\n';
    const out = ensureRelativeWorktreePaths(gc);
    expect(out).toContain('useRelativePaths = true');
    expect(out).not.toContain('useRelativePaths = false');
  });

  it('does not duplicate useRelativePaths when already set to true', () => {
    const gc = '[worktree]\n\tuseRelativePaths = true\n';
    const out = ensureRelativeWorktreePaths(gc);
    expect((out.match(/useRelativePaths/g) ?? []).length).toBe(1);
    expect(out).toContain('useRelativePaths = true');
  });
});

// ---------------------------------------------------------------------------
// Dedicated worktree mount topology
// ---------------------------------------------------------------------------

describe('dedicated worktree mount topology', () => {
  function runGit(cwd: string, args: string[]): string {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  }

  function resolveGitdirPointer(worktreeDir: string, gitdirPointer: string) {
    const prefix = 'gitdir: ';
    expect(gitdirPointer.startsWith(prefix)).toBe(true);
    const target = gitdirPointer.slice(prefix.length).trim();
    return path.isAbsolute(target) ? target : path.resolve(worktreeDir, target);
  }

  it('keeps worktree git metadata reachable when mounting the repo root', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'pi-worktree-repro-'));
    const guestRoot = mkdtempSync(path.join(tmpdir(), 'pi-guest-mount-'));
    const oldCwd = process.cwd();
    let workspace: {
      mountPath: string;
      cwdPath: string;
      cleanup: () => void;
    } | null = null;

    try {
      runGit(repoRoot, ['init']);
      runGit(repoRoot, ['config', 'user.name', 'Test User']);
      runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
      writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n', 'utf8');
      runGit(repoRoot, ['add', 'README.md']);
      runGit(repoRoot, ['commit', '-m', 'seed']);

      process.chdir(repoRoot);
      const task = {
        id: 'task-1',
        taskType: 'fulfill_brief',
        correlationId: 'correlation-1',
        input: {
          brief: 'demo task',
          title: 'demo task',
        },
      } as unknown as Parameters<typeof prepareTaskWorkspace>[0];

      workspace = prepareTaskWorkspace(task, repoRoot, {
        workspaceMode: 'dedicated_worktree',
        sessionKey: 'slot-1',
        workspaceId: 'session-slot-1',
        worktreeBranch: 'moltnet/correlation-1/demo-task',
        workspaceScope: 'session',
      });
      runGit(repoRoot, ['worktree', 'repair', '--relative-paths']);

      const guestMountRoot = path.join(guestRoot, 'workspace');
      cpSync(workspace.mountPath, guestMountRoot, { recursive: true });
      const guestWorkspace = path.join(
        guestMountRoot,
        path.relative(workspace.mountPath, workspace.cwdPath),
      );

      const gitdirPointer = readFileSync(path.join(guestWorkspace, '.git'), {
        encoding: 'utf8',
      }).trim();
      const resolvedGitdir = resolveGitdirPointer(
        guestWorkspace,
        gitdirPointer,
      );

      expect(resolvedGitdir.startsWith(guestRoot)).toBe(true);
      expect(resolvedGitdir).toContain(
        `${path.sep}.git${path.sep}worktrees${path.sep}session-slot-1`,
      );
      const adminBacklink = readFileSync(
        path.join(resolvedGitdir, 'gitdir'),
        'utf8',
      ).trim();
      expect(path.resolve(resolvedGitdir, adminBacklink)).toBe(
        path.join(guestWorkspace, '.git'),
      );
      expect(
        realpathSync(runGit(guestWorkspace, ['rev-parse', '--git-dir'])),
      ).toBe(realpathSync(resolvedGitdir));
      expect(
        realpathSync(runGit(guestWorkspace, ['rev-parse', '--show-toplevel'])),
      ).toBe(realpathSync(guestWorkspace));
    } finally {
      process.chdir(oldCwd);
      workspace?.cleanup();
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(guestRoot, { recursive: true, force: true });
    }
  });

  it('creates and cleans up scratch workspaces for repo-free eval runs', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'pi-scratch-repro-'));
    const oldCwd = process.cwd();
    let workspace: {
      mountPath: string;
      cwdPath: string;
      cleanup: () => void;
    } | null = null;

    try {
      runGit(repoRoot, ['init']);
      runGit(repoRoot, ['config', 'user.name', 'Test User']);
      runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
      writeFileSync(path.join(repoRoot, 'README.md'), 'seed\n', 'utf8');
      runGit(repoRoot, ['add', 'README.md']);
      runGit(repoRoot, ['commit', '-m', 'seed']);

      process.chdir(repoRoot);
      const task = {
        id: 'task-2',
        taskType: 'run_eval',
        correlationId: 'correlation-2',
        input: {
          scenario: { prompt: 'Evaluate this workspace' },
          variantLabel: 'baseline',
          execution: { mode: 'vitro', workspace: 'none' },
          context: [],
        },
      } as unknown as Parameters<typeof prepareTaskWorkspace>[0];

      workspace = prepareTaskWorkspace(task, repoRoot, {
        workspaceMode: 'scratch_mount',
        sessionKey: null,
        workspaceId: 'task-task-2',
        worktreeBranch: null,
        workspaceScope: 'attempt',
      });

      expect(realpathSync(workspace.mountPath)).toBe(
        realpathSync(
          path.join(
            repoRoot,
            '.moltnet',
            'd',
            'task-workspaces',
            'task-task-2',
          ),
        ),
      );
      expect(workspace.cwdPath).toBe(workspace.mountPath);
      expect(path.basename(workspace.mountPath)).toBe('task-task-2');
      expect(realpathSync(path.dirname(workspace.mountPath))).toBe(
        realpathSync(path.join(repoRoot, '.moltnet', 'd', 'task-workspaces')),
      );
      expect(workspace.mountPath).not.toBe(repoRoot);
      expect(workspace.mountPath).not.toContain(
        `${path.sep}.worktrees${path.sep}`,
      );
      expect(readFileSync(path.join(repoRoot, 'README.md'), 'utf8')).toBe(
        'seed\n',
      );
    } finally {
      process.chdir(oldCwd);
      const scratchPath = workspace?.mountPath ?? null;
      workspace?.cleanup();
      if (scratchPath) {
        expect(existsSync(scratchPath)).toBe(false);
      }
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
