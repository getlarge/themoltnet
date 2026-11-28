import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(
  readFileSync(
    new URL(
      '../../.github/workflows/adaptive-review-smoke.yml',
      import.meta.url,
    ),
    'utf8',
  ),
);
const job = workflow.jobs.review;
const step = (name: string) => {
  const found = job.steps.find((item: { name?: string }) => item.name === name);
  if (!found) throw new Error(`Missing step: ${name}`);
  return found;
};

function fixture(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'adaptive-smoke-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('headless adaptive review source smoke', () => {
  it('executes only manually dispatched main source with read-only GitHub access', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    expect(
      job.steps.find((item: { uses?: string }) =>
        item.uses?.startsWith('actions/checkout@'),
      ).with,
    ).toMatchObject({
      ref: '${{ github.sha }}',
      'persist-credentials': false,
    });
    expect(job.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
    });
    expect(step('Mint read-only reviewer token').with).toMatchObject({
      'permission-contents': 'read',
      'permission-pull-requests': 'read',
    });
    expect(job.env.ADAPTIVE_PUBLICATION).toBe('report-only');
    expect(step('Run source host and workers').with['daemon-version']).toBe(
      'workspace',
    );
    expect(
      job.steps.some((item: { uses?: string }) =>
        item.uses?.startsWith('actions/upload-artifact@'),
      ),
    ).toBe(false);
  });

  it.each([
    '0',
    '-1',
    '1\nMOLTNET_CLI_VERSION=evil',
    '9007199254740992',
    '$(touch unsafe)',
  ])('rejects invalid PR %j before invoking npm', (pr) =>
    fixture((dir) => {
      writeFileSync(join(dir, 'npm'), '#!/bin/sh\ntouch "$GITHUB_ENV"\n');
      chmodSync(join(dir, 'npm'), 0o755);
      const output = join(dir, 'env');
      expect(() =>
        execFileSync(
          'bash',
          [
            '-c',
            step('Validate smoke inputs and resolve released bootstrap CLI')
              .run,
          ],
          {
            env: {
              ...process.env,
              PATH: `${dir}:${process.env.PATH}`,
              ADAPTIVE_PR: pr,
              ADAPTIVE_MODE: 'shadow',
              GITHUB_ENV: output,
            },
            stdio: 'pipe',
          },
        ),
      ).toThrow();
      expect(() => readFileSync(output)).toThrow();
    }),
  );

  it.each(['"1.2.3"', '"latest"', '"1.2.3\\nGH_TOKEN=evil"'])(
    'accepts only an exact published bootstrap version: %s',
    (version) =>
      fixture((dir) => {
        writeFileSync(
          join(dir, 'npm'),
          '#!/bin/sh\nprintf "%s" "$MOCK_NPM_VERSION"\n',
        );
        chmodSync(join(dir, 'npm'), 0o755);
        const output = join(dir, 'env');
        const run = () =>
          execFileSync(
            'bash',
            [
              '-c',
              step('Validate smoke inputs and resolve released bootstrap CLI')
                .run,
            ],
            {
              env: {
                ...process.env,
                PATH: `${dir}:${process.env.PATH}`,
                ADAPTIVE_PR: '3090',
                ADAPTIVE_MODE: 'shadow',
                GITHUB_ENV: output,
                MOCK_NPM_VERSION: version,
              },
              stdio: 'pipe',
            },
          );
        if (version === '"1.2.3"') {
          run();
          expect(readFileSync(output, 'utf8')).toMatch(
            /^MOLTNET_CLI_VERSION=1\.2\.3\nADAPTIVE_EXECUTION_ID=[a-f0-9-]{36}\n$/,
          );
        } else {
          expect(run).toThrow();
          expect(() => readFileSync(output)).toThrow();
        }
      }),
  );

  it('fails the smoke when the host returns no report and omits finding text from summaries', () =>
    fixture((dir) => {
      const report = join(dir, 'report.json');
      const summary = join(dir, 'summary');
      const run = () =>
        execFileSync('bash', ['-c', step('Summarize lane statuses').run], {
          env: {
            ...process.env,
            ADAPTIVE_REPORT: report,
            GITHUB_STEP_SUMMARY: summary,
          },
          stdio: 'pipe',
        });
      expect(run).toThrow();
      writeFileSync(
        report,
        JSON.stringify({
          results: [
            { lane: 'docs', status: 'clear', summary: 'private finding text' },
          ],
        }),
      );
      run();
      expect(readFileSync(summary, 'utf8')).toContain('docs: clear');
      expect(readFileSync(summary, 'utf8')).not.toContain(
        'private finding text',
      );
    }));
});
