import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseReviewTaskBudgets } from '../src/config.js';
import { reviewGithubToken } from '../src/github-auth.js';
import type { StandaloneReviewInput } from '../src/standalone.js';
import {
  reviewWorkerEnvironment,
  withReviewWorkers,
} from '../src/supervisor.js';

const dirs: string[] = [];
afterEach(() => {
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const input: StandaloneReviewInput = {
  repo: 'another/project',
  pr: 7,
  correlationId: 'a1234567-1234-4123-8123-123456789012',
  teamId: 'team',
  diaryId: 'diary',
  runtimeSha: 'a'.repeat(40),
  mode: 'active',
  profiles: { classifier: 'classifier' },
  taskBudgets: parseReviewTaskBudgets(),
  protectedPaths: [],
  appLogin: 'reviewer[bot]',
  publication: 'report-only',
  runUrl: '',
  inlineFindings: false,
};

function worker() {
  const dir = mkdtempSync(join(tmpdir(), 'review-host-test-'));
  dirs.push(dir);
  const binary = join(dir, 'worker.sh');
  const pids = join(dir, 'pids');
  writeFileSync(
    binary,
    '#!/bin/sh\necho $$ >> "$TEST_WORKER_PIDS"\ntrap "exit 0" TERM\nwhile :; do sleep 1; done\n',
  );
  chmodSync(binary, 0o700);
  const ready = async () => {
    for (let n = 0; n < 100; n++) {
      try {
        return Number(readFileSync(pids, 'utf8').trim());
      } catch {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      }
    }
    throw new Error('Worker did not start');
  };
  return { dir, binary, pids, ready };
}

describe('review worker lifetime', () => {
  it('keeps publication credentials out of daemon worker environments', () => {
    const env = reviewWorkerEnvironment({
      GH_TOKEN: 'fixture-token',
      GITHUB_TOKEN: 'fixture-token',
      MOLTNET_GITHUB_APP_PRIVATE_KEY: 'fixture-pem',
      ADAPTIVE_GITHUB_APP_ID: 'fixture-app',
      MOLTNET_AGENT_KEY: 'fixture-agent-key',
      OLLAMA_API_KEY: 'fixture-provider-key',
    });
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.MOLTNET_GITHUB_APP_PRIVATE_KEY).toBeUndefined();
    expect(env.ADAPTIVE_GITHUB_APP_ID).toBeUndefined();
    expect(env.MOLTNET_AGENT_KEY).toBe('fixture-agent-key');
    expect(env.OLLAMA_API_KEY).toBe('fixture-provider-key');
  });
  it('keeps idle workers alive until workflow completion and then stops them', async () => {
    const fixture = worker();
    let pid = 0;
    expect(
      await withReviewWorkers({
        input,
        cwd: fixture.dir,
        binary: fixture.binary,
        agent: 'test-agent',
        env: { ...process.env, TEST_WORKER_PIDS: fixture.pids },
        run: async (_signal, startWorkers) => {
          await startWorkers();
          pid = await fixture.ready();
          process.kill(pid, 0);
          return 'report';
        },
      }),
    ).toBe('report');
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('aborts the coordinator and stops workers when the host is interrupted', async () => {
    const fixture = worker();
    const host = new AbortController();
    let aborted = false;
    await expect(
      withReviewWorkers({
        input,
        cwd: fixture.dir,
        binary: fixture.binary,
        agent: 'test-agent',
        env: { ...process.env, TEST_WORKER_PIDS: fixture.pids },
        signal: host.signal,
        run: async (signal, startWorkers) => {
          await startWorkers();
          await fixture.ready();
          const stopped = new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('stopped'));
            });
          });
          host.abort();
          return stopped;
        },
      }),
    ).rejects.toThrow(/Review .* host interrupted/);
    expect(aborted).toBe(true);
    const pid = Number(readFileSync(fixture.pids, 'utf8').trim());
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('bounds coordinator lifetime even before worker startup', async () => {
    const fixture = worker();
    await expect(
      withReviewWorkers({
        input,
        cwd: fixture.dir,
        binary: fixture.binary,
        agent: 'test-agent',
        env: process.env,
        signal: AbortSignal.timeout(10),
        run: (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new Error('stopped')),
            );
          }),
      }),
    ).rejects.toThrow('time budget exhausted');
  });
});

it('renews repository-scoped GitHub App tokens during a long review', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-19T00:00:00Z'));
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const requests: Array<{ url: string; body?: string | null }> = [];
  const fetchMock = vi.fn((url: string, init: RequestInit) => {
    requests.push({ url, body: init.body as string | undefined });
    return Promise.resolve(
      new Response(
        JSON.stringify(
          url.endsWith('/installation')
            ? { id: 7 }
            : {
                token: 'fixture-installation-token',
                expires_at: new Date(Date.now() + 3600_000).toISOString(),
              },
        ),
        { status: 200 },
      ),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const token = reviewGithubToken(input.repo, {
    ADAPTIVE_GITHUB_APP_ID: 'fixture-app',
    MOLTNET_GITHUB_APP_PRIVATE_KEY: keys.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
  });
  await Promise.all([token(), token()]);
  expect(requests).toHaveLength(2);
  expect(JSON.parse(requests[1].body ?? '{}')).toEqual({
    repositories: ['project'],
    permissions: { contents: 'read', pull_requests: 'write' },
  });
  vi.advanceTimersByTime(56 * 60_000);
  await token();
  expect(requests).toHaveLength(4);
});
