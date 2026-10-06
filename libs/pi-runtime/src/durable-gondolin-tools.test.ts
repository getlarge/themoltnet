import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from '@earendil-works/chord/context';
import type { VM } from '@earendil-works/gondolin';
import { Type } from '@earendil-works/pi-ai';
import type { ToolExecutionApi } from '@earendil-works/pi-durable';
import { CodingTools } from '@earendil-works/pi-durable/tools';
import { describe, expect, it, vi } from 'vitest';

import { GondolinDurableEnv } from './durable-gondolin-env.js';
import {
  adaptDurableTools,
  createDurableGondolinTools,
} from './durable-gondolin-tools.js';
import { filterModelVisibleTools } from './runtime-definition.js';
import { createGondolinToolLifecycle } from './tool-operations.js';

function setup(image = false) {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  const readFile = vi
    .fn()
    .mockResolvedValue(
      image ? Buffer.from(png, 'base64') : Buffer.from('one\ntwo\nthree'),
    );
  const access = vi.fn().mockResolvedValue(undefined);
  const stat = vi.fn().mockImplementation((path: string) =>
    Promise.resolve({
      isDirectory: () => path === '/workspace',
      isFile: () => path !== '/workspace',
      isSymbolicLink: () => false,
    }),
  );
  const listDir = vi.fn().mockResolvedValue(['README.md']);
  const exec = vi.fn((argv: string[]) => {
    if (argv[0] === 'rg')
      return Object.assign(Promise.resolve({ exitCode: 0 }), {
        output: async function* () {
          await Promise.resolve();
          yield {
            stream: 'stdout',
            data: Buffer.from(
              JSON.stringify({
                type: 'match',
                data: {
                  path: { text: '/workspace/README.md' },
                  lines: { text: 'two' },
                  line_number: 2,
                },
              }) + '\n',
            ),
          };
        },
      });
    return Promise.resolve({
      ok: true,
      stdout: image ? 'image/png' : 'text/plain',
    });
  });
  const vm = { fs: { readFile, access, stat, listDir }, exec } as unknown as VM;
  const lifecycle = createGondolinToolLifecycle();
  const env = new GondolinDurableEnv(
    vm,
    'vm',
    '/workspace',
    undefined,
    lifecycle,
  );
  const tools = createDurableGondolinTools({
    vm,
    cwdPath: '/host/project',
    guestWorkspace: '/workspace',
    lifecycle,
    model: undefined,
  });
  const api = { callId: 'read-test', env } as unknown as ToolExecutionApi;
  const invoke = (name: string, args: Record<string, unknown>) =>
    tools
      .find((tool) => tool.name === name)!
      .execute(args, api, BACKGROUND_CONTEXT);
  return {
    readFile,
    access,
    exec,
    listDir,
    tools,
    api,
    env,
    lifecycle,
    invoke,
  };
}

describe('Durable Gondolin coding tools', () => {
  it('routes reads and searches to the guest and preserves native pagination', async () => {
    const { invoke, readFile, listDir } = setup();
    expect(
      (await invoke('read', { path: 'README.md', offset: 2, limit: 1 }))
        .content,
    ).toEqual([{ type: 'text', text: expect.stringContaining('two') }]);
    expect(readFile).toHaveBeenCalledWith('/workspace/README.md');
    expect((await invoke('ls', { path: '.' })).content).toEqual([
      { type: 'text', text: 'README.md' },
    ]);
    expect((await invoke('find', { pattern: '*.md' })).content).toEqual([
      { type: 'text', text: 'README.md' },
    ]);
    expect(
      (await invoke('grep', { pattern: 'two', path: '.' })).content,
    ).toEqual([
      { type: 'text', text: expect.stringContaining('README.md:2: two') },
    ]);
    expect(listDir).toHaveBeenCalledWith('/workspace', expect.anything());
  });

  it('returns image content through the native image-aware read tool', async () => {
    const { invoke } = setup(true);
    const result = await invoke('read', { path: 'pixel.png' });
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image',
          mimeType: 'image/png',
          data: expect.any(String),
        }),
      ]),
    );
  });

  it('keeps Durable write/edit/bash and filters tools by the effective policy', () => {
    const { tools } = setup();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'bash',
      'edit',
      'find',
      'grep',
      'ls',
      'read',
      'write',
    ]);
    for (const name of ['bash', 'edit', 'write']) {
      expect(tools.find((tool) => tool.name === name)).toBe(
        CodingTools.tools!.find((tool) => tool.name === name),
      );
    }
    expect(
      filterModelVisibleTools(tools, {
        enforcement: 'enforce',
        allowedTools: new Set(['read', 'find']),
        allowedShellCommands: [],
      }).map((tool) => tool.name),
    ).toEqual(['read', 'find']);
  });

  it('blocks both tool families after retirement, including failed retirement', async () => {
    const { lifecycle, invoke, env, readFile, exec, access } = setup();
    lifecycle.markRetired({
      backendRetired: false,
      reason: 'backend-retirement-failed',
      trigger: 'cancellation',
    });
    await expect(invoke('read', { path: 'README.md' })).rejects.toMatchObject({
      code: 'sandbox_retired',
    });
    expect((await env.readTextFile('README.md', BACKGROUND_CONTEXT)).ok).toBe(
      false,
    );
    expect((await env.exec('pwd', {}, BACKGROUND_CONTEXT)).ok).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it('rejects cancelled calls before accessing the guest', async () => {
    const { tools, api, access } = setup();
    const controller = new AbortController();
    controller.abort(new Error('lease lost'));
    await expect(
      tools
        .find((tool) => tool.name === 'read')!
        .execute(
          { path: 'README.md' },
          api,
          withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
        ),
    ).rejects.toThrow('lease lost');
    expect(access).not.toHaveBeenCalled();
  });
});

it('does not automatically replay host effects and refuses interactive approval in headless execution', async () => {
  const execute = vi.fn(async (_id, _args, _signal, _update, context) => ({
    content: [
      {
        type: 'text' as const,
        text: String(await context.ui.confirm('Host execution', 'Approve?')),
      },
    ],
    details: { optional: undefined },
  }));
  const [tool] = adaptDurableTools(
    [
      {
        name: 'host_action',
        label: 'Host action',
        description: 'Host action',
        parameters: Type.Object({}),
        execute,
      },
    ],
    { cwd: '/workspace', model: undefined },
  );
  expect(tool.replay).toBe('unsafe');
  expect(
    await tool.execute(
      {},
      { callId: 'call' } as ToolExecutionApi,
      BACKGROUND_CONTEXT,
    ),
  ).toEqual({ content: [{ type: 'text', text: 'false' }], details: {} });
  execute.mockClear();
  await expect(
    tool.execute(
      {},
      { callId: 'call' } as ToolExecutionApi,
      withAbortSignal(AbortSignal.abort(), BACKGROUND_CONTEXT),
    ),
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
