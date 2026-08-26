import { GUEST_TASK_CONTEXT_MOUNT } from '@themoltnet/sandbox-gondolin';
import { describe, expect, it, vi } from 'vitest';

import {
  createGondolinBashOps,
  createGondolinFindOps,
  createGondolinLsOps,
  createGondolinReadOps,
  createGondolinToolLifecycle,
  executeGondolinGrep,
  GondolinVmRetiredError,
  toGuestPath,
} from './tool-operations.js';

function completedExec(
  exitCode: number,
  chunks: Array<{ data: Buffer | string; stream: 'stdout' | 'stderr' }> = [],
) {
  return Object.assign(Promise.resolve({ exitCode }), {
    output: async function* () {
      await Promise.resolve();
      yield* chunks;
    },
  });
}

function pendingExec() {
  const pending = new Promise<never>(() => {
    // VM retirement must complete without trusting guest process settlement.
  });
  return Object.assign(pending, {
    output: async function* () {
      await pending;
      yield { data: Buffer.alloc(0), stream: 'stdout' as const };
    },
  });
}

describe('toGuestPath', () => {
  it('accepts normalized guest workspace paths', () => {
    expect(
      toGuestPath(
        '/Users/ed/project',
        '/Users/ed/project//src/index.ts',
        '/Users/ed/project/',
      ),
    ).toBe('/Users/ed/project/src/index.ts');
  });

  it('accepts normalized task context mount paths', () => {
    expect(
      toGuestPath(
        '/Users/ed/project',
        `${GUEST_TASK_CONTEXT_MOUNT}//skills/example/SKILL.md`,
        '/Users/ed/project',
      ),
    ).toBe(`${GUEST_TASK_CONTEXT_MOUNT}/skills/example/SKILL.md`);
  });

  it('maps host-relative paths into the normalized guest workspace', () => {
    expect(
      toGuestPath(
        '/Users/ed/project',
        '/Users/ed/project/src/index.ts',
        '/Users/ed/project/',
      ),
    ).toBe('/Users/ed/project/src/index.ts');
  });

  it('accepts paths in a dedicated worktree nested under the mount', () => {
    const mountPath = '/Users/ed/project';
    const cwdPath = `${mountPath}/.worktrees/task-1624`;

    expect(toGuestPath(cwdPath, `${cwdPath}/src/index.ts`, mountPath)).toBe(
      `${cwdPath}/src/index.ts`,
    );
  });

  it('rejects paths escaping the mount from a nested worktree cwd', () => {
    const mountPath = '/Users/ed/project';
    const cwdPath = `${mountPath}/.worktrees/task-1624`;

    expect(() =>
      toGuestPath(cwdPath, `${mountPath}/../secret.txt`, mountPath),
    ).toThrow(/path escapes workspace/);
  });
});

describe('Gondolin read-only tool operations', () => {
  const stat = (directory: boolean) => ({
    isDirectory: () => directory,
  });
  const rgMatch = (guestPath: string, lineNumber: number, lineText: string) =>
    JSON.stringify({
      type: 'match',
      data: {
        path: { text: guestPath },
        line_number: lineNumber,
        lines: { text: lineText },
      },
    }) + '\n';
  const proc = (
    chunks: Array<{ data: string | Buffer; stream?: string }>,
    exitCode = 0,
  ) =>
    Object.assign(Promise.resolve({ exitCode }), {
      output: async function* () {
        await Promise.resolve();
        for (const chunk of chunks) yield chunk;
      },
    });

  it('routes ls operations through VM fs with guest path mapping', async () => {
    const calls: string[] = [];
    const vm = {
      fs: {
        access: (p: string) => {
          calls.push(`access:${p}`);
          return Promise.resolve();
        },
        stat: (p: string) => {
          calls.push(`stat:${p}`);
          return Promise.resolve(stat(true));
        },
        listDir: (p: string) => {
          calls.push(`list:${p}`);
          return Promise.resolve(['src']);
        },
      },
    };

    const ops = createGondolinLsOps(
      vm as never,
      '/Users/ed/project',
      '/workspace',
    );

    await expect(ops.exists('/Users/ed/project')).resolves.toBe(true);
    expect((await ops.stat('/Users/ed/project/src')).isDirectory()).toBe(true);
    await expect(ops.readdir('/Users/ed/project/src')).resolves.toEqual([
      'src',
    ]);
    expect(calls).toEqual([
      'access:/workspace',
      'stat:/workspace/src',
      'list:/workspace/src',
    ]);
  });

  it('routes read operations through VM fs without shelling out to cat', async () => {
    const calls: string[] = [];
    const vm = {
      fs: {
        access: (p: string) => {
          calls.push(`access:${p}`);
          return Promise.resolve();
        },
        readFile: (p: string) => {
          calls.push(`read:${p}`);
          return Promise.resolve(Buffer.from('hello'));
        },
      },
      exec: () => {
        throw new Error('unexpected exec');
      },
    };

    const ops = createGondolinReadOps(
      vm as never,
      '/Users/ed/project',
      '/workspace',
    );

    await expect(ops.access('/Users/ed/project/README.md')).resolves.toBe(
      undefined,
    );
    await expect(ops.readFile('/Users/ed/project/README.md')).resolves.toEqual(
      Buffer.from('hello'),
    );
    expect(calls).toEqual([
      'access:/workspace/README.md',
      'read:/workspace/README.md',
    ]);
  });

  it('finds files by walking the VM filesystem', async () => {
    const vm = {
      fs: {
        access: () => Promise.resolve(),
        stat: (p: string) =>
          Promise.resolve(
            stat(
              p === '/workspace' ||
                p === '/workspace/src' ||
                p === '/workspace/node_modules' ||
                p === '/workspace/out-tsc',
            ),
          ),
        listDir: (p: string) => {
          if (p === '/workspace') {
            return Promise.resolve([
              'src',
              'README.md',
              'index.ts',
              'node_modules',
              'out-tsc',
            ]);
          }
          if (p === '/workspace/src') {
            return Promise.resolve(['index.ts', 'index.test.ts']);
          }
          if (p === '/workspace/out-tsc') {
            return Promise.resolve(['generated.ts']);
          }
          return Promise.resolve([]);
        },
      },
    };

    const ops = createGondolinFindOps(
      vm as never,
      '/Users/ed/project',
      '/workspace',
    );

    await expect(
      ops.glob('**/*.ts', '/Users/ed/project', {
        ignore: ['**/out-tsc/**'],
        limit: 10,
      }),
    ).resolves.toEqual([
      '/Users/ed/project/src/index.ts',
      '/Users/ed/project/src/index.test.ts',
      '/Users/ed/project/index.ts',
    ]);
  });

  it('greps with ripgrep inside the VM and applies limits', async () => {
    const stats: string[] = [];
    const execs: unknown[] = [];
    const vm = {
      fs: {
        stat: (p: string) => {
          stats.push(p);
          return Promise.resolve(stat(p === '/workspace'));
        },
      },
      exec: (...args: unknown[]) => {
        execs.push(args);
        return proc([
          {
            data:
              rgMatch('/workspace/src/one.ts', 2, 'needle one\n') +
              rgMatch('/workspace/src/two.ts', 1, 'needle two\n'),
          },
        ]);
      },
    };

    const result = await executeGondolinGrep(
      vm as never,
      '/Users/ed/project',
      '/workspace',
      { pattern: 'needle', glob: '*.ts', limit: 2 },
    );

    expect(stats).toEqual(['/workspace']);
    expect(execs[0]).toEqual([
      [
        'rg',
        '--json',
        '--line-number',
        '--color=never',
        '--hidden',
        '--max-filesize',
        '2M',
        '--glob',
        '*.ts',
        '--',
        'needle',
        '/workspace',
      ],
      expect.objectContaining({ stdout: 'pipe', stderr: 'pipe' }),
    ]);
    expect(result.content[0]?.text).toContain('src/one.ts:2: needle one');
    expect(result.content[0]?.text).toContain('src/two.ts:1: needle two');
    expect(result.content[0]?.text).toContain('2 matches limit reached');
    expect(result.details).toMatchObject({ matchLimitReached: 2 });
  });

  it('reads bounded context lines through VM fs after ripgrep matches', async () => {
    const reads: string[] = [];
    const vm = {
      fs: {
        stat: () => Promise.resolve(stat(true)),
        readFile: (p: string) => {
          reads.push(p);
          return Promise.resolve('alpha\nneedle\nomega');
        },
      },
      exec: () =>
        proc([
          {
            data: rgMatch('/workspace/src/one.ts', 2, 'needle\n'),
          },
        ]),
    };

    const result = await executeGondolinGrep(
      vm as never,
      '/Users/ed/project',
      '/workspace',
      { pattern: 'needle', context: 1 },
    );

    expect(reads).toEqual(['/workspace/src/one.ts']);
    expect(result.content[0]?.text).toContain('src/one.ts-1- alpha');
    expect(result.content[0]?.text).toContain('src/one.ts:2: needle');
    expect(result.content[0]?.text).toContain('src/one.ts-3- omega');
  });
});

describe('Gondolin bash operations', () => {
  it('routes output through the managed login-shell runner', async () => {
    const output = Buffer.from('ok');
    const exec = vi.fn((_command: unknown) =>
      completedExec(0, [{ data: output, stream: 'stdout' }]),
    );
    const close = vi.fn();
    const onData = vi.fn();
    const retireVm = vi.fn();
    const operations = createGondolinBashOps(
      { exec, close } as never,
      '/Users/ed/project',
      '/workspace',
      { lifecycle: createGondolinToolLifecycle(), retireVm },
    );

    await expect(
      operations.exec('printf ok', '/Users/ed/project', {
        onData,
        timeout: 0,
      } as never),
    ).resolves.toEqual({ exitCode: 0 });
    expect(exec.mock.calls[0]?.[0]).toEqual(['/bin/sh', '-lc', 'printf ok']);
    expect(onData).toHaveBeenCalledWith(output, 'stdout');
    expect(close).not.toHaveBeenCalled();
    expect(retireVm).not.toHaveBeenCalled();
  });

  it('invalidates runtime state after cancellation retires the VM', async () => {
    const controller = new AbortController();
    const exec = vi.fn(() => pendingExec());
    const close = vi.fn().mockResolvedValue(undefined);
    const retireVm = vi.fn().mockResolvedValue(undefined);
    const lifecycle = createGondolinToolLifecycle();
    const operations = createGondolinBashOps(
      { exec, close } as never,
      '/Users/ed/project',
      '/workspace',
      { lifecycle, retireVm },
    );
    const pending = operations.exec('sleep 10', '/Users/ed/project', {
      onData: vi.fn(),
      signal: controller.signal,
      timeout: 0,
    } as never);

    await vi.waitFor(() => expect(exec).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toThrow('aborted');
    expect(retireVm).toHaveBeenCalledWith({
      backendRetired: true,
      reason: 'backend-retired',
      trigger: 'cancellation',
    });
    expect(lifecycle.getRetirement()).toEqual({
      backendRetired: true,
      reason: 'backend-retired',
      trigger: 'cancellation',
    });
    expect(close).toHaveBeenCalledOnce();

    await expect(
      operations.exec('printf stale', '/Users/ed/project', {
        onData: vi.fn(),
        timeout: 0,
      } as never),
    ).rejects.toBeInstanceOf(GondolinVmRetiredError);
    expect(exec).toHaveBeenCalledOnce();
  });

  it('surfaces host-side VM retirement failures', async () => {
    const controller = new AbortController();
    const exec = vi.fn(() => pendingExec());
    const close = vi.fn().mockRejectedValue(new Error('close failed'));
    const lifecycle = createGondolinToolLifecycle();
    const operations = createGondolinBashOps(
      { exec, close } as never,
      '/Users/ed/project',
      '/workspace',
      {
        lifecycle,
        retireVm: async ({ backendRetired }) => {
          if (!backendRetired) await close();
        },
      },
    );
    const pending = operations.exec('sleep 10', '/Users/ed/project', {
      onData: vi.fn(),
      signal: controller.signal,
      timeout: 0,
    } as never);

    await vi.waitFor(() => expect(exec).toHaveBeenCalledOnce());
    controller.abort();

    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GondolinVmRetiredError);
    expect(failure).toMatchObject({
      code: 'sandbox_retired',
      retirement: {
        backendRetired: false,
        reason: 'backend-retirement-failed',
        trigger: 'cancellation',
      },
    });
    expect(lifecycle.getRetirement()).toEqual(
      expect.objectContaining({ reason: 'backend-retirement-failed' }),
    );
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('preserves timeout classification while poisoning the retired VM', async () => {
    const exec = vi.fn(() => pendingExec());
    const close = vi.fn().mockResolvedValue(undefined);
    const lifecycle = createGondolinToolLifecycle();
    const operations = createGondolinBashOps(
      { exec, close } as never,
      '/Users/ed/project',
      '/workspace',
      {
        lifecycle,
        retireVm: vi.fn().mockResolvedValue(undefined),
      },
    );

    await expect(
      operations.exec('sleep 10', '/Users/ed/project', {
        onData: vi.fn(),
        timeout: 0.001,
      } as never),
    ).rejects.toThrow('timeout:0.001');
    expect(lifecycle.getRetirement()).toMatchObject({
      backendRetired: true,
      trigger: 'timeout',
    });
  });
});
