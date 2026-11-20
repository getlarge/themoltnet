import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));

type Workflow = {
  jobs: Record<
    string,
    {
      steps: {
        uses?: string;
        with?: { 'fetch-depth'?: number; filter?: string };
      }[];
    }
  >;
};

describe('docs build checkout', () => {
  it.each([
    ['ci.yml', 'agents'],
    ['deploy-docs.yml', 'build'],
  ])('%s / %s retains history trees for page timestamps', (file, job) => {
    const workflow = parse(
      readFileSync(join(root, '.github/workflows', file), 'utf8'),
    ) as Workflow;
    const checkout = workflow.jobs[job].steps.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );

    expect(checkout).toBeDefined();
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    // Full and blobless clones can answer path-history queries locally.
    // Treeless clones fetch missing historical trees during each git log.
    expect([undefined, 'blob:none']).toContain(checkout?.with?.filter);
  });

  it.each([
    ['tree:0', true],
    ['blob:none', false],
  ])('%s history query lazy-fetches trees: %s', (filter, needsFetch) => {
    const dir = mkdtempSync(join(tmpdir(), 'docs-checkout-'));
    const source = join(dir, 'source');
    const clone = join(dir, 'clone');
    const trace = join(dir, 'trace.jsonl');
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    };
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, {
        cwd,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      });
    const commit = (message: string) =>
      git(
        source,
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '-am',
        message,
      );

    try {
      git(dir, 'init', '--initial-branch=main', source);
      git(source, 'config', 'uploadpack.allowFilter', 'true');
      writeFileSync(join(source, 'page.md'), '# Page\n');
      git(source, 'add', 'page.md');
      commit('Add page');
      writeFileSync(join(source, 'other.md'), '# Another page\n');
      git(source, 'add', 'other.md');
      commit('Change another path');
      const expected = git(
        source,
        'log',
        '-1',
        '--pretty=%ai',
        '--',
        'page.md',
      );
      git(
        dir,
        'clone',
        `--filter=${filter}`,
        '--no-checkout',
        pathToFileURL(source).href,
        clone,
      );

      const actual = execFileSync(
        'git',
        ['log', '-1', '--pretty=%ai', '--', 'page.md'],
        {
          cwd: clone,
          env: { ...env, GIT_TRACE2_EVENT: trace },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10_000,
        },
      );
      const events = readFileSync(trace, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { event: string; argv?: string[] });
      const fetches = events.filter(
        (event) =>
          event.event === 'child_start' && event.argv?.includes('fetch'),
      );

      expect(actual).toBe(expected);
      expect(fetches.length > 0).toBe(needsFetch);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
