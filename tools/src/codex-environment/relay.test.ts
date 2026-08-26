import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { type ExecServerProcess, startExecServerRelay } from './relay.js';

class FakeExecServer extends EventEmitter implements ExecServerProcess {
  readonly writes: string[] = [];
  readonly result = Promise.resolve({ exitCode: 0 });
  #ended = false;
  #chunks: { stream: 'stdout' | 'stderr'; data: Uint8Array }[] = [];
  #wake: (() => void) | undefined;

  write(data: string | Uint8Array): void {
    const text = Buffer.from(data).toString('utf8');
    this.writes.push(text);
    if (text.includes('\n')) {
      this.#chunks.push({
        stream: 'stdout',
        data: Buffer.from('{"jsonrpc":"2.0","result":"ok"}\n'),
      });
      this.#wake?.();
    }
  }

  end(): void {
    this.#ended = true;
    this.#wake?.();
  }

  async *output(): AsyncIterable<{
    stream: 'stdout' | 'stderr';
    data: Uint8Array;
  }> {
    while (!this.#ended || this.#chunks.length > 0) {
      const chunk = this.#chunks.shift();
      if (chunk) {
        yield chunk;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
      this.#wake = undefined;
    }
  }
}

function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function nextMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => resolve(data.toString()));
    socket.once('error', reject);
  });
}

describe('startExecServerRelay', () => {
  it('creates one exec-server per WebSocket and relays JSONL frames', async () => {
    const processes: FakeExecServer[] = [];
    const relay = await startExecServerRelay({
      createExecServer: () => {
        const process = new FakeExecServer();
        processes.push(process);
        return process;
      },
    });
    const first = await openSocket(relay.url);
    const second = await openSocket(relay.url);

    const response = nextMessage(first);
    first.send('{"jsonrpc":"2.0","id":1}');
    await expect(response).resolves.toBe('{"jsonrpc":"2.0","result":"ok"}');
    expect(relay.connectionCount()).toBe(2);
    expect(processes).toHaveLength(2);
    expect(processes[0]?.writes.join('')).toContain('\n');

    first.close();
    second.close();
    await Promise.all([relay.close(), relay.close()]);
  });
});
