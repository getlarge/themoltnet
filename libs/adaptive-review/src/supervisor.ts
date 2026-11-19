import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StandaloneReviewInput } from './standalone.js';

export interface ReviewWorkerSpec {
  profile: string;
  taskType: 'classify' | 'freeform';
  runtime?: string;
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
  ])
    delete workerEnv[name];
  return workerEnv;
}

/** Capacity only: routing and follow-up decisions stay inside Absurd. */
export function reviewWorkerSpecs(
  input: StandaloneReviewInput,
  focusedRuntime?: string,
): ReviewWorkerSpec[] {
  return [
    { profile: input.profiles.classifier, taskType: 'classify' as const },
    ...Object.entries(input.profiles).flatMap(([pool, profile]) =>
      pool === 'classifier' || !profile
        ? []
        : Array.from({ length: pool === 'focused' ? 4 : 1 }, () => ({
            profile,
            taskType: 'freeform' as const,
            ...(pool === 'focused' && focusedRuntime
              ? { runtime: focusedRuntime }
              : {}),
          })),
    ),
  ];
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
    '86400',
    '--wait-after-task-sec',
    '86400',
    '--max-poll-interval-ms',
    '3000',
    ...(bindingFile
      ? ['--config-file', bindingFile, '--binding', 'adaptive-review']
      : ['--team', input.teamId]),
    ...(worker.runtime ? ['--runtime', worker.runtime] : []),
  ];
}

/** Run review-scoped workers for exactly the coordinator host's lifetime. */
export async function withReviewWorkers<T>(args: {
  input: StandaloneReviewInput;
  cwd: string;
  env: NodeJS.ProcessEnv;
  binary: string;
  agent: string;
  timeoutSec: number;
  focusedRuntime?: string;
  signal?: AbortSignal;
  run: (signal: AbortSignal, startWorkers: () => Promise<void>) => Promise<T>;
}): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'adaptive-workers-'));
  const children: ChildProcess[] = [];
  let stopping = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  let running: Promise<T> | undefined;
  let rejectHost: (reason: Error) => void = () => {};
  const failed = new Promise<never>((_resolve, reject) => {
    rejectHost = reject;
  });
  // Attach before any child can emit an error.
  void failed.catch(() => {});
  const abort = () =>
    rejectHost(
      new Error('Review host interrupted; resume with the same execution ID'),
    );
  args.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (args.signal?.aborted) throw new Error('Review host interrupted');
    let bindingFile: string | undefined;
    if (args.input.projectId) {
      bindingFile = join(dir, 'projects.json');
      writeFileSync(
        bindingFile,
        JSON.stringify({
          version: 1,
          bindings: [
            {
              name: 'adaptive-review',
              apiUrl: args.env.MOLTNET_API_URL ?? 'https://api.themolt.net',
              teamId: args.input.teamId,
              projectId: args.input.projectId,
              source: args.cwd,
              strategy: 'existing',
            },
          ],
        }),
        { mode: 0o600 },
      );
    }
    const startWorkers = () => {
      for (const worker of reviewWorkerSpecs(args.input, args.focusedRuntime)) {
        const child = spawn(
          args.binary,
          reviewWorkerArgs(args.input, worker, args.agent, bindingFile),
          {
            cwd: args.cwd,
            env: reviewWorkerEnvironment(args.env),
            stdio: ['ignore', 'inherit', 'inherit'],
            // Terminate descendants too, including executor helper processes.
            detached: process.platform !== 'win32',
          },
        );
        children.push(child);
        child.once('error', () =>
          rejectHost(
            new Error(`Unable to start review worker for ${worker.profile}`),
          ),
        );
        child.once('exit', (code, signal) => {
          if (!stopping)
            rejectHost(
              new Error(
                `Review worker ${worker.profile} exited (${code ?? signal}); resume the review with replacement workers`,
              ),
            );
        });
      }
      return Promise.resolve();
    };
    timeout = setTimeout(
      () =>
        rejectHost(
          new Error(
            'Review host time budget exhausted; resume with the same execution ID',
          ),
        ),
      args.timeoutSec * 1000,
    );
    running = args.run(controller.signal, startWorkers);
    return await Promise.race([running, failed]);
  } finally {
    stopping = true;
    controller.abort();
    await running?.catch(() => {});
    if (timeout) clearTimeout(timeout);
    args.signal?.removeEventListener('abort', abort);
    await Promise.all(
      children.map(async (child) => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null)
          return;
        const pid = child.pid;
        const send = (signal: NodeJS.Signals) => {
          try {
            if (process.platform === 'win32') child.kill(signal);
            else process.kill(-pid, signal);
          } catch {
            /* Already exited. */
          }
        };
        const exited = once(child, 'exit').catch(() => {});
        send('SIGTERM');
        const force = setTimeout(() => send('SIGKILL'), 10_000);
        try {
          await exited;
        } finally {
          clearTimeout(force);
        }
      }),
    );
    rmSync(dir, { recursive: true, force: true });
  }
}
