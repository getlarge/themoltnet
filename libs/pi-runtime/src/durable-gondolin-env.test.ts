import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { VM } from '@earendil-works/gondolin';
import { expect, it, vi } from 'vitest';

import { GondolinDurableEnv } from './durable-gondolin-env.js';
import { createGondolinToolLifecycle } from './tool-operations.js';

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
  const result = await env.exec(
    'test',
    {
      spill: { afterBytes: 2, afterLines: 1 },
      onOutput: (text) => {
        output.push(text);
      },
    },
    BACKGROUND_CONTEXT,
  );
  expect(result).toEqual({
    ok: true,
    value: { exitCode: 7, spillPath: '/tmp/spill' },
  });
  expect(output.join('')).toBe('warning\n€');
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
    controller.signal,
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
      undefined,
      lifecycle,
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
