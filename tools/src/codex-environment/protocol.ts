import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

export interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string };
  method?: string;
  params?: unknown;
}

interface NotificationWaiter {
  predicate: (message: JsonRpcResponse) => boolean;
  resolve: (message: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class JsonlRpcClient {
  readonly #input: Writable;
  readonly #notifications: JsonRpcResponse[] = [];
  readonly #pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  readonly #waiters = new Set<NotificationWaiter>();
  #nextId = 1;

  constructor(input: Writable, output: Readable) {
    this.#input = input;
    const outputLines = createInterface({ input: output });
    outputLines.on('line', (line) => this.#onLine(line));
    outputLines.on('close', () =>
      this.#rejectAll(new Error('Codex App Server output closed')),
    );
  }

  request<T>(method: string, params: unknown, timeoutMs = 10_000): Promise<T> {
    const id = this.#nextId++;
    this.#input.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
    });
  }

  notify(method: string, params: unknown): void {
    this.#input.write(`${JSON.stringify({ method, params })}\n`);
  }

  waitForNotification(
    predicate: (message: JsonRpcResponse) => boolean,
    timeoutMs = 30_000,
  ): Promise<JsonRpcResponse> {
    const observed = this.#notifications.find(predicate);
    if (observed) return Promise.resolve(observed);
    return new Promise((resolve, reject) => {
      const waiter: NotificationWaiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#waiters.delete(waiter);
          reject(new Error('timed out waiting for Codex notification'));
        }, timeoutMs),
      };
      this.#waiters.add(waiter);
    });
  }

  notifications(): readonly JsonRpcResponse[] {
    return this.#notifications;
  }

  #onLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      this.#rejectAll(new Error('Codex App Server emitted invalid JSONL'));
      return;
    }
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new Error(message.error.message ?? 'Codex App Server request failed'),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    this.#notifications.push(message);
    for (const waiter of this.#waiters) {
      if (!waiter.predicate(message)) continue;
      this.#waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.#waiters.clear();
  }
}

export interface SpawnedAppServer {
  client: JsonlRpcClient;
  close(): Promise<void>;
}

export function spawnCodexAppServer(options: {
  codexBinary: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): SpawnedAppServer {
  const child: ChildProcessWithoutNullStreams = spawn(
    options.codexBinary,
    ['app-server', '--listen', 'stdio://', '--enable', 'deferred_executor'],
    {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  child.stderr.on('data', (chunk) => {
    if (process.env.MOLTNET_CODEX_PROBE_DEBUG === '1') {
      process.stderr.write(chunk);
    }
  });
  const client = new JsonlRpcClient(child.stdin, child.stdout);
  let closePromise: Promise<void> | undefined;
  const close = async (): Promise<void> => {
    child.stdin.end();
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => {
      child.once('exit', resolve);
    });
    let timeoutId: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutId = setTimeout(() => resolve('timeout'), 3_000);
    });
    if ((await Promise.race([exited, timeout])) === 'timeout') {
      child.kill('SIGTERM');
      await exited;
    }
    if (timeoutId) clearTimeout(timeoutId);
  };
  return {
    client,
    close() {
      closePromise ??= close();
      return closePromise;
    },
  };
}
