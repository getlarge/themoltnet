import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { claimedTaskIds, reportActionSpend } from './spend.js';
import { loadAction, stepById } from './test-support.js';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), setOutput: vi.fn() }));
vi.mock('@themoltnet/sdk/node', () => ({ connect: mocks.connect }));
vi.mock('@actions/core', () => ({ setOutput: mocks.setOutput }));
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  vi.resetAllMocks();
});

it('uses only claim receipts, ignoring arbitrary task IDs and repeated logs', () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const claim = JSON.stringify({ msg: 'agent-runtime.task_claimed', taskId });
  expect(
    claimedTaskIds(`startup\n${claim}\n${claim}\n{"taskId":"other"}`),
  ).toEqual([taskId]);
});

it('collects every correlation page and writes only accounting to outputs and CI summary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spend-test-'));
  dirs.push(dir);
  const list = vi
    .fn()
    .mockResolvedValueOnce({
      items: [
        {
          id: 'a',
          taskType: 'freeform',
          tags: ['lane:security', 'stage:hunt'],
        },
      ],
      nextCursor: 'next',
    })
    .mockResolvedValueOnce({
      items: [{ id: 'b', taskType: 'classify' }],
      nextCursor: null,
    });
  mocks.connect.mockResolvedValue({
    tasks: {
      list,
      listAttempts: vi.fn().mockResolvedValue([
        {
          claimedAt: '2026-01-01',
          startedAt: null,
          completedAt: '2026-01-02',
          usage: null,
          output: 'private evidence',
        },
      ]),
    },
  });
  await reportActionSpend({
    RUNNER_TEMP: dir,
    GITHUB_STEP_SUMMARY: join(dir, 'summary'),
    MOLTNET_TEAM_ID: 'team',
    SPEND_CORRELATION: 'correlation',
    TASK_ID: 'unrelated-ambient-task',
  });
  expect(list).toHaveBeenLastCalledWith(
    { correlationId: 'correlation', limit: 100, cursor: 'next' },
    { teamId: 'team' },
  );
  const summary = readFileSync(join(dir, 'summary'), 'utf8');
  expect(summary).toContain('lane:security / stage:hunt');
  expect(summary).toContain('0/2 fully priced');
  expect(summary).not.toContain('private evidence');
  expect(summary).toContain('0/2 fully priced tasks');
  const path = mocks.setOutput.mock.calls.find(
    ([key]) => key === 'report',
  )![1] as string;
  expect(readFileSync(path, 'utf8')).not.toContain('private evidence');
});

it('reports a connection failure as missing telemetry instead of free execution', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spend-test-'));
  dirs.push(dir);
  mocks.connect.mockRejectedValue(new Error('private credential detail'));
  await reportActionSpend({
    TASK_ID: 'a',
    RUNNER_TEMP: dir,
    GITHUB_STEP_SUMMARY: join(dir, 'summary'),
  });
  expect(readFileSync(join(dir, 'summary'), 'utf8')).toContain(
    '1 with missing telemetry',
  );
});

it('marks an unavailable task list as incomplete discovery without inventing a task', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spend-test-'));
  dirs.push(dir);
  mocks.connect.mockResolvedValue({
    tasks: { list: vi.fn().mockRejectedValue(new Error('private details')) },
  });
  await reportActionSpend({
    SPEND_CORRELATION: 'correlation',
    MOLTNET_TEAM_ID: 'team',
    RUNNER_TEMP: dir,
    GITHUB_STEP_SUMMARY: join(dir, 'summary'),
  });
  expect(readFileSync(join(dir, 'summary'), 'utf8')).toContain(
    'Task discovery is incomplete',
  );
  const path = mocks.setOutput.mock.calls.find(
    ([key]) => key === 'report',
  )![1] as string;
  expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
    discoveryIncomplete: true,
    records: [],
  });
});

it('keeps pipefail and collects spend after failed execution before cleanup', () => {
  const action = loadAction();
  expect(stepById(action, 'run').run).toContain('set -euo pipefail');
  expect(stepById(action, 'run').run).toContain(
    'tee "$ACTION_TEMP/daemon.log"',
  );
  expect(stepById(action, 'spend').if).toContain('always()');
  expect(action.runs.steps.findIndex((s) => s.id === 'spend')).toBeGreaterThan(
    action.runs.steps.findIndex((s) => s.id === 'run'),
  );
});
