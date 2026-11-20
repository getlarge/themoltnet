import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { MAX_HOST_TIMEOUT_SEC } from './host-settings.js';
import type { StandaloneReviewInput } from './standalone.js';
import { MAX_FOCUSED_WORKERS, type ReviewCapacity } from './workers.js';

const WORKER_POLL_INTERVAL_MS = 3000;

export interface ReviewWorkerSpec {
  pool: string;
  index: number;
  profile: string;
  taskType: 'classify' | 'freeform';
  runtime?: string;
  strategy: 'none' | 'git-worktree';
}

/** Model workers do not need the coordinator's GitHub publication authority. */
export function reviewWorkerEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const workerEnv = { ...source };
  for (const name of [
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'MOLTNET_GITHUB_APP_PRIVATE_KEY',
    'ADAPTIVE_GITHUB_APP_ID',
    'ADAPTIVE_DATABASE_URL',
    'DATABASE_URL',
    'ADAPTIVE_TEST_DATABASE_URL',
  ])
    delete workerEnv[name];
  return workerEnv;
}

/** Capacity only: routing and follow-up decisions stay inside Absurd. */
export function reviewWorkerSpecs(
  input: StandaloneReviewInput,
  focusedRuntime?: string,
  capacity: readonly ReviewCapacity[] = Object.entries(input.profiles).flatMap(
    ([pool, profile]) =>
      profile
        ? [
            {
              pool: pool as ReviewCapacity['pool'],
              profile,
              count: pool === 'focused' ? MAX_FOCUSED_WORKERS : 1,
            },
          ]
        : [],
  ),
): ReviewWorkerSpec[] {
  return capacity.flatMap(({ pool, profile, count }) =>
    Array.from(
      { length: input.projectId && pool === 'docs' ? 2 : count },
      (_, index) => ({
        pool,
        index: index + 1,
        profile,
        taskType:
          pool === 'classifier' ? ('classify' as const) : ('freeform' as const),
        strategy:
          pool === 'classifier' ||
          pool === 'complexity' ||
          (pool === 'docs' && index === 0)
            ? ('none' as const)
            : ('git-worktree' as const),
        ...(pool === 'focused' && focusedRuntime
          ? { runtime: focusedRuntime }
          : {}),
      }),
    ),
  );
}

export function reviewWorkerArgs(
  input: StandaloneReviewInput,
  worker: ReviewWorkerSpec,
  agent: string,
  bindingFile?: string,
): string[] {
  return [
    'drain',
    '--agent',
    agent,
    '--profile',
    worker.profile,
    '--task-types',
    worker.taskType,
    '--correlation-id',
    input.correlationId,
    // The supervisor owns lifetime. An empty queue must not strand a later
    // branch or repair; the finite host timeout bounds these waiting workers.
    '--wait-for-first-task-sec',
    String(MAX_HOST_TIMEOUT_SEC),
    '--wait-after-task-sec',
    String(MAX_HOST_TIMEOUT_SEC),
    '--max-poll-interval-ms',
    String(WORKER_POLL_INTERVAL_MS),
    ...(bindingFile
      ? [
          '--config-file',
          bindingFile,
          '--binding',
          `adaptive-review-${worker.strategy}`,
        ]
      : ['--general', '--team', input.teamId]),
    ...(worker.runtime ? ['--runtime', worker.runtime] : []),
  ];
}

function writeBindingFile(
  dir: string,
  input: StandaloneReviewInput,
  cwd: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (!input.projectId) return;
  const file = join(dir, 'projects.json');
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      bindings: (['none', 'git-worktree'] as const).map((strategy) => ({
        name: `adaptive-review-${strategy}`,
        apiUrl: env.MOLTNET_API_URL ?? 'https://api.themolt.net',
        teamId: input.teamId,
        projectId: input.projectId,
        ...(strategy === 'git-worktree' ? { source: cwd } : {}),
        strategy,
      })),
    }),
    { mode: 0o600 },
  );
  return file;
}

function guardianArgs(): string[] {
  const built = new URL('./review-worker.js', import.meta.url);
  if (existsSync(built)) return [fileURLToPath(built)];
  return [
    '--import',
    createRequire(import.meta.url).resolve('tsx'),
    fileURLToPath(new URL('./review-worker.ts', import.meta.url)),
  ];
}

/** Preserve structured daemon records and identify non-JSON startup output too. */
function forwardOutput(child: ChildProcess, label: string): void {
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    const lines = createInterface({ input: stream });
    lines.on('line', (line) => {
      try {
        const record: unknown = JSON.parse(line);
        if (record && typeof record === 'object' && !Array.isArray(record)) {
          process.stderr.write(
            JSON.stringify({
              ...record,
              reviewWorker: label,
              guardianPid: child.pid,
            }) + '\n',
          );
          return;
        }
      } catch {
        /* Human-readable subprocess output. */
      }
      process.stderr.write(
        `[${label} guardian=${child.pid ?? 'starting'}] ${line}\n`,
      );
    });
  }
}

interface ReviewWorkerHost {
  input: StandaloneReviewInput;
  cwd: string;
  env: NodeJS.ProcessEnv;
  binary: string;
  agent: string;
  focusedRuntime?: string;
}

function spawnWorker(
  args: ReviewWorkerHost,
  worker: ReviewWorkerSpec,
  bindingFile: string | undefined,
  fail: (error: Error) => void,
  isStopping: () => boolean,
): ChildProcess {
  const label = `${worker.pool}#${worker.index}`;
  const child = spawn(
    process.execPath,
    [
      ...guardianArgs(),
      args.binary,
      ...reviewWorkerArgs(args.input, worker, args.agent, bindingFile),
    ],
    {
      cwd: args.cwd,
      env: reviewWorkerEnvironment(args.env),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  forwardOutput(child, label);
  child.on('message', (message: unknown) => {
    if (
      !isStopping() &&
      message &&
      typeof message === 'object' &&
      'event' in message &&
      message.event === 'review.worker.exited'
    ) {
      const record = message as {
        pid?: number;
        code?: number;
        signal?: string;
      };
      fail(
        new Error(
          `Review worker ${label} pid=${record.pid ?? child.pid} exited (${record.code ?? record.signal}); resume review ${args.input.correlationId}`,
        ),
      );
    }
  });
  child.once('error', (cause) =>
    fail(
      new Error(
        `Unable to start review worker ${label} pid=${child.pid ?? 'none'}`,
        { cause },
      ),
    ),
  );
  child.once('exit', (code, signal) => {
    if (!isStopping())
      fail(
        new Error(
          `Review worker ${label} pid=${child.pid} exited (${code ?? signal}); resume review ${args.input.correlationId}`,
        ),
      );
  });
  return child;
}

async function stopWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit').catch(() => {});
  if (child.connected) child.disconnect();
  child.kill('SIGTERM');
  await exited;
}

/** The workflow requests capacity; the host owns process lifetime, never routing. */
export async function withReviewWorkers<T>(
  args: ReviewWorkerHost & {
    signal?: AbortSignal;
    run: (
      signal: AbortSignal,
      ensureCapacity: (capacity?: readonly ReviewCapacity[]) => Promise<void>,
    ) => Promise<T>;
  },
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'adaptive-workers-'));
  const children = new Map<string, ChildProcess>();
  let stopping = false;
  const controller = new AbortController();
  let running: Promise<T> | undefined;
  let rejectHost: (error: Error) => void = () => {};
  const failed = new Promise<never>((_resolve, reject) => {
    rejectHost = reject;
  });
  void failed.catch(() => {});
  const fail = (error: Error) => {
    rejectHost(error);
    controller.abort(error);
  };
  const abort = () =>
    fail(
      new Error(
        `Review ${args.input.correlationId} ${args.signal?.reason instanceof Error && args.signal.reason.name === 'TimeoutError' ? 'time budget exhausted' : 'host interrupted'}; resume with the same execution ID`,
      ),
    );
  args.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (args.signal?.aborted) abort();
    controller.signal.throwIfAborted();
    const bindingFile = writeBindingFile(dir, args.input, args.cwd, args.env);
    const ensureCapacity = (capacity?: readonly ReviewCapacity[]) => {
      controller.signal.throwIfAborted();
      for (const worker of reviewWorkerSpecs(
        args.input,
        args.focusedRuntime,
        capacity,
      )) {
        const label = `${worker.pool}#${worker.index}`;
        if (children.has(label)) continue;
        children.set(
          label,
          spawnWorker(args, worker, bindingFile, fail, () => stopping),
        );
      }
      return Promise.resolve();
    };
    running = args.run(controller.signal, ensureCapacity);
    return await Promise.race([running, failed]);
  } finally {
    stopping = true;
    controller.abort();
    args.signal?.removeEventListener('abort', abort);
    // Guardians stop their daemon groups immediately, while the coordinator drains.
    const stopped = [...children.values()].map(stopWorker);
    await Promise.all([running?.catch(() => {}), ...stopped]);
    rmSync(dir, { recursive: true, force: true });
  }
}
