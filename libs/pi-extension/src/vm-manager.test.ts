/**
 * Unit tests for vm-manager helpers:
 *   - rewriteMoltnetJsonPaths: portability of host-absolute paths into VM
 *   - loadCredentials: PEM reading and filename extraction
 *   - ensureRelativeWorktreePaths: gitconfig mutation (pre-existing)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ensureRelativeWorktreePaths,
  loadCredentials,
  rewriteMoltnetJsonPaths,
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
