import { describe, expect, it } from 'vitest';

import {
  createGondolinFindOps,
  createGondolinLsOps,
  createGondolinReadOps,
  executeGondolinGrep,
  toGuestPath,
} from './tool-operations.js';
import { GUEST_TASK_SKILLS_MOUNT } from './vm-manager.js';

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

  it('accepts normalized task skills mount paths', () => {
    expect(
      toGuestPath(
        '/Users/ed/project',
        `${GUEST_TASK_SKILLS_MOUNT}//skill/SKILL.md`,
        '/Users/ed/project',
      ),
    ).toBe(`${GUEST_TASK_SKILLS_MOUNT}/skill/SKILL.md`);
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
        '/bin/rg',
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
