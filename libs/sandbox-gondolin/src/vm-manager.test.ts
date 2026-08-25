/**
 * Unit tests for vm-manager helpers:
 *   - loadCredentials: host-authenticated boundary (no guest credentials)
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
import { describe, expect, it } from 'vitest';

import {
  AutoParentMemoryProvider,
  loadCredentials,
  resolveVfsShadowConfig,
  resolveVmAgentDir,
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

describe('loadCredentials', () => {
  it('returns no MoltNet guest credentials (host-authenticated is the only boundary)', () => {
    expect(loadCredentials()).toEqual({ agentEnv: {} });
  });
});
