import type { RawData, WebSocket } from 'ws';
import { WebSocketServer } from 'ws';

export interface ExecServerProcess {
  output(): AsyncIterable<{
    stream: 'stdout' | 'stderr';
    data: Uint8Array;
  }>;
  write(data: string | Uint8Array): void;
  end(): void;
  result: Promise<unknown>;
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  return Buffer.from(data);
}

export interface ExecServerRelay {
  url: string;
  connectionCount(): number;
  close(): Promise<void>;
}

/** Bridge Codex's WebSocket transport to one guest JSONL exec-server process. */
export async function startExecServerRelay(options: {
  createExecServer: () => ExecServerProcess;
  onGuestStderr?: (text: string) => void;
}): Promise<ExecServerRelay> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Codex exec-server relay did not bind a TCP port');
  }

  let connectionCount = 0;
  const sockets = new Set<WebSocket>();
  const processes = new Set<ExecServerProcess>();
  const pumps = new Set<Promise<void>>();
  const relayErrors: unknown[] = [];

  server.on('connection', (socket) => {
    connectionCount += 1;
    sockets.add(socket);
    const process = options.createExecServer();
    processes.add(process);

    const pump = (async () => {
      try {
        let buffer = '';
        for await (const chunk of process.output()) {
          const text = Buffer.from(chunk.data).toString('utf8');
          if (chunk.stream === 'stderr') {
            options.onGuestStderr?.(text);
            continue;
          }
          buffer += text;
          for (;;) {
            const newline = buffer.indexOf('\n');
            if (newline < 0) break;
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (line !== '' && socket.readyState === socket.OPEN) {
              socket.send(line);
            }
          }
        }
        if (buffer !== '' && socket.readyState === socket.OPEN) {
          socket.send(buffer);
        }
        socket.close();
      } catch (error) {
        relayErrors.push(error);
        socket.close(1011, 'guest exec-server relay failed');
      }
    })().finally(() => pumps.delete(pump));
    pumps.add(pump);

    socket.on('message', (data) => {
      const frame = rawDataToBuffer(data);
      process.write(frame);
      if (frame.at(-1) !== 10) process.write('\n');
    });
    socket.once('close', () => {
      sockets.delete(socket);
      process.end();
    });
    void process.result.then(
      () => processes.delete(process),
      () => processes.delete(process),
    );
  });

  let closePromise: Promise<void> | undefined;
  const close = async (): Promise<void> => {
    for (const socket of sockets) socket.terminate();
    for (const process of processes) process.end();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await Promise.allSettled([...processes].map((process) => process.result));
    await Promise.allSettled(pumps);
    if (relayErrors.length > 0) {
      throw new AggregateError(relayErrors, 'guest exec-server relay failed');
    }
  };
  return {
    url: `ws://127.0.0.1:${address.port}`,
    connectionCount: () => connectionCount,
    close() {
      closePromise ??= close();
      return closePromise;
    },
  };
}
