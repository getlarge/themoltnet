import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(
  readFileSync(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  ),
) as {
  jobs: Record<
    string,
    {
      env: Record<string, string>;
      needs?: string[];
      steps: Array<{ name?: string; run?: string }>;
    }
  >;
};
const job = workflow.jobs['e2e-orchestration'];
const bootstrap = job.steps.find(
  (step) => step.name === 'Start Absurd Postgres and run migrations',
)?.run;
if (!bootstrap) throw new Error('missing orchestration bootstrap');

describe('orchestration database endpoint handoff', () => {
  it.each([
    ['0.0.0.0:40123', '40123'],
    ['0.0.0.0:48217\n[::]:48217', '48217'],
    ['[::]:51234', '51234'],
    ['', null],
    ['0.0.0.0:not-a-port', null],
  ])('exports the allocated port from %j or fails closed', (binding, port) => {
    const dir = mkdtempSync(join(tmpdir(), 'orchestration-port-'));
    try {
      const envFile = join(dir, 'github-env');
      writeFileSync(envFile, '');
      writeFileSync(
        join(dir, 'docker'),
        '#!/bin/sh\ncase "$*" in *" port "*) printf "%s\\n" "$TEST_DB_BINDING";; esac\n',
        { mode: 0o755 },
      );
      const result = spawnSync(
        'bash',
        ['-e', '-o', 'pipefail', '-c', bootstrap],
        {
          env: {
            ...job.env,
            PATH: `${dir}:${process.env.PATH ?? ''}`,
            GITHUB_ENV: envFile,
            TEST_DB_BINDING: binding,
          },
          encoding: 'utf8',
        },
      );
      if (port) {
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(envFile, 'utf8')).toBe(
          `ORCHESTRATION_ABSURD_URL=postgresql://absurd:absurd_secret@127.0.0.1:${port}/absurd\n`,
        );
      } else {
        expect(result.status).not.toBe(0);
        expect(readFileSync(envFile, 'utf8')).toBe('');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it('owns full adaptive review E2E outside the neutral daemon lanes', () => {
  const review = workflow.jobs['e2e-adaptive-review'];
  expect(review.needs).toContain('orchestrator');
  expect(
    review.steps.some((step) =>
      step.run?.includes('@themoltnet/adaptive-review-e2e:e2e'),
    ),
  ).toBe(true);
  const daemon = Object.values(workflow.jobs).filter((job) =>
    job.steps?.some((step) =>
      step.run?.includes('@themoltnet/agent-daemon-e2e:e2e'),
    ),
  );
  expect(daemon).toHaveLength(1);
  expect(daemon[0].steps.some((step) => step.run?.includes('absurd-db'))).toBe(
    false,
  );
});
