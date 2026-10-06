import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { expect, it } from 'vitest';

import { remoteLog } from '../__tests__/durable-log.js';
import type { DurableStoreTransport } from './durable-storage.js';

it('reconciles committed output in a fresh process after SIGKILL before task completion', async () => {
  const { transport } = remoteLog();
  const children: ReturnType<typeof spawn>[] = [];
  const run = (mode: string, event: string) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(
          new URL('../__tests__/durable-process.ts', import.meta.url),
        ),
        mode,
      ],
      {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      },
    );
    children.push(child);
    const finished = once(child, 'exit');
    const ready = new Promise<Record<string, unknown>>((resolve, reject) => {
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.once('error', reject);
      child.once('exit', (code, signal) =>
        reject(new Error(`worker exited ${code ?? signal}: ${stderr}`)),
      );
      child.on(
        'message',
        (message: {
          id?: number;
          method?: string;
          input?: unknown;
          event?: string;
        }) => {
          if (message.event === event) {
            resolve(message as Record<string, unknown>);
            return;
          }
          if (!message.method) return;
          void (async () => {
            let value: unknown;
            if (message.method === 'read')
              value = await transport.read(
                message.input as number,
                BACKGROUND_CONTEXT,
              );
            else if (message.method === 'append')
              value = await transport.append(
                message.input as Parameters<DurableStoreTransport['append']>[0],
                BACKGROUND_CONTEXT,
              );
            else if (message.method === 'mintId')
              value = await transport.mintId();
            child.send({ id: message.id, value });
          })().catch(reject);
        },
      );
    });
    return { child, ready, finished };
  };
  try {
    const first = run('crash', 'persisted');
    await first.ready;
    first.child.kill('SIGKILL');
    await first.finished;
    const second = run('resume', 'result');
    const resumed = await second.ready;
    expect(resumed).toMatchObject({
      modelCalls: 0,
      preparations: 0,
      result: {
        status: 'completed',
        attemptN: 1,
        output: { summary: 'Persisted before process death' },
      },
    });
    await second.finished;
  } finally {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null)
        child.kill('SIGKILL');
  }
}, 30_000);
