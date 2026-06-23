import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { connectMock, execFileSyncMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  execFileSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock('@themoltnet/sdk', () => ({
  connect: connectMock,
}));

import { resolveAgentContext } from './agent-context.js';

describe('resolveAgentContext', () => {
  beforeEach(() => {
    connectMock.mockReset();
    connectMock.mockResolvedValue({ agent: 'connected' });
    execFileSyncMock.mockReset();
  });

  it('uses an explicit repo-free root when credentials exist there', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-agent-root-'));
    execFileSyncMock.mockImplementation(() => {
      throw new Error('not a git repo');
    });

    try {
      writeCredentials(root, 'legreffier');

      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: root,
      });

      const agentDir = join(root, '.moltnet', 'legreffier');
      expect(ctx.agentDir).toBe(agentDir);
      expect(ctx.agentRootDir).toBe(root);
      expect(connectMock).toHaveBeenCalledWith({ configDir: agentDir });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the git root when the explicit root has no credentials', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'daemon-sandbox-root-'));
    const gitRoot = mkdtempSync(join(tmpdir(), 'daemon-git-root-'));
    execFileSyncMock.mockReturnValue(`${gitRoot}\n`);

    try {
      writeCredentials(gitRoot, 'legreffier');

      const ctx = await resolveAgentContext('legreffier', {
        agentRootDir: sandboxRoot,
      });

      const agentDir = join(gitRoot, '.moltnet', 'legreffier');
      expect(ctx.agentDir).toBe(agentDir);
      expect(ctx.agentRootDir).toBe(gitRoot);
      expect(connectMock).toHaveBeenCalledWith({ configDir: agentDir });
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
      rmSync(gitRoot, { recursive: true, force: true });
    }
  });
});

function writeCredentials(root: string, agentName: string): void {
  const agentDir = join(root, '.moltnet', agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'moltnet.json'), '{}\n', 'utf8');
}
