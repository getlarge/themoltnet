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
          `ORCHESTRATION_ABSURD_URL=postgresql://issue_lifecycle:issue_lifecycle_secret@127.0.0.1:${port}/issue_lifecycle\n`,
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
