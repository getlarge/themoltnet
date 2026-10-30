import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { VM } from '@earendil-works/gondolin';
import { describe, expect, it, vi } from 'vitest';

import { GondolinDurableEnv } from '../src/durable-gondolin-env.js';
import { createGondolinToolLifecycle } from '../src/tool-operations.js';

it('decodes split UTF-8 per stream and waits for guest spill writes', async () => {
  const euro = Buffer.from('€');
  const chunks = [
    { stream: 'stdout', data: euro.subarray(0, 1) },
    { stream: 'stderr', data: Buffer.from('warning\n') },
    { stream: 'stdout', data: euro.subarray(1) },
  ];
  const files = new Map<string, string>();
  let writing = false;
  const exec = vi.fn((argv: string[], options: { stdin?: Buffer }) => {
    if (argv[0] === 'mktemp')
      return Promise.resolve({ ok: true, stdout: '/tmp/spill\n' });
    if (argv[2] === 'cat >> "$1"')
      return (async () => {
        expect(writing).toBe(false);
        writing = true;
        await new Promise((resolve) => {
          setTimeout(resolve, 1);
        });
        files.set(
          argv[4],
          (files.get(argv[4]) ?? '') + options.stdin!.toString(),
        );
        writing = false;
        return { ok: true };
      })();
    return Object.assign(Promise.resolve({ exitCode: 7 }), {
      output: async function* () {
        yield* chunks;
      },
    });
  });
  const writeFile = vi.fn(async (path: string, text: string) => {
    files.set(path, text);
  });
  const env = new GondolinDurableEnv(
    { exec, fs: { writeFile } } as unknown as VM,
    'vm',
    '/workspace',
  );
  const output: string[] = [];
  const streams: string[] = [];
  const result = await env.exec(
    'test',
    {
      spill: { afterBytes: 2, afterLines: 1 },
      onOutput: (text, _context, info) => {
        output.push(text);
        streams.push(info.stream);
      },
    },
    BACKGROUND_CONTEXT,
  );
  expect(result).toEqual({
    ok: true,
    value: { exitCode: 7, spillPath: '/tmp/spill' },
  });
  expect(output.join('')).toBe('warning\n€');
  expect(streams).toEqual(['stdout', 'stderr', 'stdout']);
  expect(files.get('/tmp/spill')).toBe('warning\n€');
  expect(writing).toBe(false);
});
it('rejects file and shell work after lifetime cancellation without touching the guest', async () => {
  const controller = new AbortController();
  controller.abort(new Error('writer lost'));
  const exec = vi.fn();
  const readFile = vi.fn();
  const env = new GondolinDurableEnv(
    { exec, fs: { readFile } } as unknown as VM,
    'vm',
    '/workspace',
    { lifetime: controller.signal },
  );
  expect((await env.readTextFile('file', BACKGROUND_CONTEXT)).ok).toBe(false);
  const result = await env.exec('echo secret', {}, BACKGROUND_CONTEXT);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe('aborted');
  expect(exec).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
});

it.each([false, true])(
  'poisons the shared tool lifecycle after command timeout (retirement fails: %s)',
  async (fails) => {
    const pending = new Promise<never>(() => {});
    const exec = vi.fn(() =>
      Object.assign(pending, {
        output: async function* () {
          await pending;
          yield { stream: 'stdout' as const, data: Buffer.alloc(0) };
        },
      }),
    );
    const close = fails
      ? vi.fn().mockRejectedValue(new Error('retirement failed'))
      : vi.fn().mockResolvedValue(undefined);
    const onRetired = vi.fn();
    const lifecycle = createGondolinToolLifecycle({ onRetired });
    const env = new GondolinDurableEnv(
      { exec, close } as unknown as VM,
      'vm',
      '/workspace',
      { lifecycle },
    );
    const result = await env.exec(
      'sleep 300',
      { timeout: 0.005 },
      BACKGROUND_CONTEXT,
    );
    expect(result.ok).toBe(false);
    expect(lifecycle.getRetirement()).toEqual({
      backendRetired: !fails,
      reason: fails ? 'backend-retirement-failed' : 'backend-retired',
      trigger: 'timeout',
    });
    expect(onRetired).toHaveBeenCalledOnce();
    expect((await env.exec('pwd', {}, BACKGROUND_CONTEXT)).ok).toBe(false);
    expect(exec).toHaveBeenCalledOnce();
  },
);

describe('workspace confinement', () => {
  function confined() {
    const fs = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue('text'),
      rename: vi.fn().mockResolvedValue(undefined),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    };
    const exec = vi.fn();
    const env = new GondolinDurableEnv(
      { exec, fs } as unknown as VM,
      'vm',
      '/workspace/project',
      { roots: ['/workspace', '/moltnet-task-context'] },
    );
    return { env, fs, exec };
  }

  it.each([
    '/usr/local/bin/git',
    '../../etc/profile',
    '/workspace-other/file',
    '/tmp/file',
  ])('rejects a write to %s without touching the guest', async (path) => {
    const { env, fs } = confined();
    const result = await env.writeFile(path, 'x', BACKGROUND_CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('permission_denied');
    expect((await env.absolutePath(path, BACKGROUND_CONTEXT)).ok).toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('rejects mutations whose second path escapes', async () => {
    const { env, fs } = confined();
    expect(
      (await env.renameFile('a', '/usr/bin/a', BACKGROUND_CONTEXT)).ok,
    ).toBe(false);
    expect(
      (await env.remove('/etc', { recursive: true }, BACKGROUND_CONTEXT)).ok,
    ).toBe(false);
    expect(
      (await env.createDir('/opt/x', undefined, BACKGROUND_CONTEXT)).ok,
    ).toBe(false);
    expect(fs.rename).not.toHaveBeenCalled();
    expect(fs.deleteFile).not.toHaveBeenCalled();
    expect(fs.mkdir).not.toHaveBeenCalled();
  });

  it('resolves allowed paths against the working directory', async () => {
    const { env, fs } = confined();
    expect((await env.writeFile('src/a.ts', 'x', BACKGROUND_CONTEXT)).ok).toBe(
      true,
    );
    expect(
      (await env.writeFile('../shared.txt', 'x', BACKGROUND_CONTEXT)).ok,
    ).toBe(true);
    expect(
      (
        await env.readTextFile(
          '/moltnet-task-context/brief.md',
          BACKGROUND_CONTEXT,
        )
      ).ok,
    ).toBe(true);
    expect(fs.writeFile.mock.calls.map(([path]) => path)).toEqual([
      '/workspace/project/src/a.ts',
      '/workspace/shared.txt',
    ]);
  });

  it('refuses a shell working directory outside the workspace', async () => {
    const { env, exec } = confined();
    const result = await env.exec(
      'ls',
      { cwd: '/usr/local/bin' },
      BACKGROUND_CONTEXT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('spawn_error');
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('output spilling', () => {
  function spilling(chunks: Buffer[], options: { hang?: boolean } = {}) {
    const files = new Map<string, string>();
    const appends: string[] = [];
    const pending = new Promise<never>(() => {});
    const exec = vi.fn((argv: string[], execOptions: { stdin?: Buffer }) => {
      if (argv[0] === 'mktemp')
        return Promise.resolve({ ok: true, stdout: '/tmp/spill\n' });
      if (argv[2] === 'cat >> "$1"') {
        appends.push(execOptions.stdin!.toString());
        files.set(
          argv[4],
          (files.get(argv[4]) ?? '') + execOptions.stdin!.toString(),
        );
        return Promise.resolve({ ok: true });
      }
      const done = options.hang ? pending : Promise.resolve({ exitCode: 0 });
      return Object.assign(done, {
        output: async function* () {
          for (const data of chunks) yield { stream: 'stdout' as const, data };
          if (options.hang) await pending;
        },
      });
    });
    const writeFile = vi.fn(async (path: string, text: string) => {
      files.set(path, text);
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const env = new GondolinDurableEnv(
      { exec, close, fs: { writeFile } } as unknown as VM,
      'vm',
      '/workspace',
    );
    return { env, files, appends };
  }

  it('appends spilled output in batches', async () => {
    const chunks = Array.from({ length: 200 }, (_, i) =>
      Buffer.from(`line ${i}\n`),
    );
    const { env, files, appends } = spilling(chunks);
    const result = await env.exec(
      'noisy',
      { spill: { afterBytes: 10, afterLines: 1 } },
      BACKGROUND_CONTEXT,
    );
    expect(result).toEqual({
      ok: true,
      value: { exitCode: 0, spillPath: '/tmp/spill' },
    });
    expect(files.get('/tmp/spill')).toBe(chunks.join(''));
    expect(appends.length).toBe(1);
  });

  it('reports the spill file of a command that timed out', async () => {
    const { env } = spilling(
      [Buffer.from('one\n'), Buffer.from('two\n'), Buffer.from('three\n')],
      { hang: true },
    );
    const result = await env.exec(
      'slow',
      { timeout: 0.05, spill: { afterBytes: 2, afterLines: 1 } },
      BACKGROUND_CONTEXT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('timeout');
      expect(result.error.spillPath).toBe('/tmp/spill');
    }
  });
});

it('reports unsupported guest handle and watch capabilities explicitly', async () => {
  const env = new GondolinDurableEnv({} as VM, 'vm', '/workspace');
  const results = await Promise.all([
    env.openBinaryReader('file', undefined, BACKGROUND_CONTEXT),
    env.openDirReader('.', BACKGROUND_CONTEXT),
    env.watch([{ path: '.' }], () => {}, BACKGROUND_CONTEXT),
  ]);
  for (const result of results) {
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'not_supported' },
    });
  }
});
