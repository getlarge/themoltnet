/**
 * Unit tests for vm-manager helpers:
 *   - rewriteMoltnetJsonPaths: portability of host-absolute paths into VM
 *   - ensureRelativeWorktreePaths: gitconfig mutation (pre-existing)
 */
import { describe, expect, it } from 'vitest';

import {
  ensureRelativeWorktreePaths,
  rewriteMoltnetJsonPaths,
} from './vm-manager.js';

// ---------------------------------------------------------------------------
// rewriteMoltnetJsonPaths
// ---------------------------------------------------------------------------

describe('rewriteMoltnetJsonPaths', () => {
  const vmAgentDir = '/home/agent/.moltnet/legreffier';
  const vmSshDir = `${vmAgentDir}/ssh`;

  it('rewrites ssh paths to VM-local equivalents', () => {
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

  it('returns the original string if JSON.parse throws', () => {
    const bad = 'not json {{{';
    expect(rewriteMoltnetJsonPaths(bad, vmAgentDir, vmSshDir, null)).toBe(bad);
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
