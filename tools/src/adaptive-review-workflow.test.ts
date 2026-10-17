import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../../.github/workflows/adaptive-review.yml', import.meta.url),
  'utf8',
);

function prepareScript(): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === '          script: |');
  if (start < 0) throw new Error('Prepare script is missing');
  const script: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line && !line.startsWith('            ')) break;
    script.push(line.slice(12));
  }
  return script.join('\n');
}

type ReviewFile = { filename: string; previous_filename?: string };

async function runPrepare(options: {
  files?: ReviewFile[];
  changedFiles?: number;
  author?: string;
  headRepo?: string;
}) {
  const files = options.files ?? [{ filename: 'apps/console/src/App.tsx' }];
  const outputs = new Map<string, string>();
  const pullRequest = {
    number: 42,
    title: 'Review title',
    body: 'Review body',
    changed_files: options.changedFiles ?? files.length,
    base: { sha: 'base-sha' },
    head: {
      sha: 'head-sha',
      repo: { full_name: options.headRepo ?? 'getlarge/themoltnet' },
    },
    user: { login: options.author ?? 'contributor' },
  };
  const execute = new Script(
    `(async (github, context, core, require, process) => {\n${prepareScript()}\n})`,
  ).runInNewContext() as (...args: unknown[]) => Promise<void>;
  await execute(
    {
      paginate: async () => files,
      rest: { pulls: { listFiles: () => undefined } },
    },
    {
      repo: { owner: 'getlarge', repo: 'themoltnet' },
      payload: { pull_request: pullRequest },
      runId: 100,
    },
    { setOutput: (key: string, value: string) => outputs.set(key, value) },
    createRequire(import.meta.url),
    { env: { GITHUB_RUN_ATTEMPT: '1' } },
  );
  return outputs;
}

function job(name: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) throw new Error(`Job ${name} is missing`);
  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[a-z][a-z-]*:$/.test(line),
  );
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

describe('adaptive review workflow trust gates', () => {
  it('pins an eligible PR before starting workers', async () => {
    const outputs = await runPrepare({});
    expect(outputs.get('skip')).toBe('false');
    expect(JSON.parse(outputs.get('prepared') ?? '{}')).toMatchObject({
      repo: 'getlarge/themoltnet',
      pr: 42,
      base: 'base-sha',
      head: 'head-sha',
    });
  });

  it.each([
    ['fork', { headRepo: 'other/themoltnet' }],
    ['Dependabot', { author: 'dependabot[bot]' }],
    ['incomplete file list', { changedFiles: 2 }],
    [
      'workflow edit',
      { files: [{ filename: '.github/workflows/adaptive-review.yml' }] },
    ],
    [
      'library edit',
      { files: [{ filename: 'libs/adaptive-review/src/core.ts' }] },
    ],
    [
      'action edit',
      { files: [{ filename: 'packages/adaptive-review-action/action.yml' }] },
    ],
    [
      'renamed protected file',
      {
        files: [
          {
            filename: 'docs/old-workflow.md',
            previous_filename: '.github/workflows/adaptive-review.yml',
          },
        ],
      },
    ],
  ])('skips %s before preparing a review', async (_case, options) => {
    const outputs = await runPrepare(options);
    expect(outputs.get('skip')).toBe('true');
    expect(outputs.has('prepared')).toBe(false);
  });

  it('gates every downstream job that can reach credentials', () => {
    expect(job('prepare')).toContain(
      'if: github.event.pull_request.draft == false',
    );
    expect(job('route')).toContain("if: needs.prepare.outputs.skip == 'false'");
    expect(job('review')).toContain("if: needs.route.result == 'success'");
    expect(job('classifier-worker')).toContain(
      "if: needs.prepare.outputs.classifier-needed == 'true'",
    );
    expect(job('specialist-workers')).toContain(
      "if: needs.route.outputs.has-specialists == 'true'",
    );
    for (const name of [
      'route',
      'review',
      'classifier-worker',
      'specialist-workers',
    ]) {
      expect(job(name)).toMatch(/needs: (prepare|\[prepare, route\])/);
    }
  });
});
