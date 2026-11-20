import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import {
  actionReviewCorrelation,
  executionCorrelation,
} from '../src/identity.js';
import { runReviewCommand } from '../src/run-cli.js';
import type { AdaptiveReport } from '../src/workflow.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'review-cli-'));
  dirs.push(dir);
  return {
    argv: [],
    cwd: dir,
    source: { GITHUB_OUTPUT: join(dir, 'output') },
    stdout: vi.fn(),
    stderr: vi.fn(),
  };
}
it.each(['clear', 'concern', 'unclear', 'failed'] as const)(
  'returns the correct exit and coverage for %s',
  async (status) => {
    const args = fixture();
    const report = {
      correlationId: 'review',
      gaps: [],
      routing: { routes: [] },
      results: [{ lane: 'tests', status }],
    } as unknown as AdaptiveReport;
    const code = await runReviewCommand({
      ...args,
      run: () =>
        Promise.resolve({ status: 'completed', report, published: false }),
    });
    expect(code).toBe(status === 'failed' ? 1 : 0);
    expect(args.stderr).toHaveBeenCalledTimes(
      status === 'failed' || status === 'unclear' ? 1 : 0,
    );
    expect(readFileSync(args.source.GITHUB_OUTPUT, 'utf8')).toContain(
      'result={"skip":false}',
    );
  },
);
it('fails closed on command failure and includes sanitized underlying failure details', async () => {
  const args = fixture();
  const source = { ...args.source, GH_TOKEN: 'private-token-value' };
  expect(
    await runReviewCommand({
      ...args,
      source,
      run: () =>
        Promise.reject(
          new Error('workflow failed', {
            cause: { message: 'underlying private-token-value failure' },
          }),
        ),
    }),
  ).toBe(1);
  const output = readFileSync(source.GITHUB_OUTPUT, 'utf8');
  expect(output).toContain('result={"skip":true}');
  expect(output).not.toContain('skip=false');
  expect(args.stderr.mock.calls[0][0]).toContain(
    'underlying [redacted] failure',
  );
});
it('forwards cancellation and reports a skipped review without running failed work', async () => {
  const args = fixture();
  const controller = new AbortController();
  const run = vi.fn(
    (
      _argv: string[],
      _source: NodeJS.ProcessEnv,
      _cwd: string,
      signal?: AbortSignal,
    ) => {
      expect(signal).toBe(controller.signal);
      return Promise.resolve({ status: 'skipped' as const, reason: 'fork' });
    },
  );
  expect(
    await runReviewCommand({ ...args, run, signal: controller.signal }),
  ).toBe(0);
  expect(readFileSync(args.source.GITHUB_OUTPUT, 'utf8')).toContain(
    'skip=true',
  );
});
it('uses one correlation derivation with explicit attempt separation', () => {
  const source = {
    ADAPTIVE_REPOSITORY: 'owner/repo',
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '2',
    ADAPTIVE_EXECUTION_MODE: 'ephemeral',
  };
  expect(actionReviewCorrelation(source)).toBe(
    executionCorrelation('owner/repo:123:attempt:2'),
  );
  expect(
    actionReviewCorrelation({ ...source, ADAPTIVE_EXECUTION_MODE: 'durable' }),
  ).toBe(executionCorrelation('owner/repo:123'));
});
it('documents explicit retry after exhausted attempts in CLI help', async () => {
  const args = fixture();
  expect(await runReviewCommand({ ...args, argv: ['--help'] })).toBe(0);
  expect(args.stdout.mock.calls[0][0]).toContain('ADAPTIVE_RETRY_FAILED=true');
});
