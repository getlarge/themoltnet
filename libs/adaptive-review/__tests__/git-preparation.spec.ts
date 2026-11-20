import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { githubChildEnvironment } from '../src/github-environment.js';
import type { PinnedPullRequest } from '../src/host-deps.js';
import { createReviewHostDeps } from '../src/host-deps.js';
import { ensureReviewGit } from '../src/standalone-host.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
it('gives GitHub subprocesses only their scoped token and runner environment', () => {
  expect(
    githubChildEnvironment(
      {
        PATH: '/bin',
        HOME: '/home',
        MOLTNET_PRIVATE_KEY: 'seed',
        MOLTNET_AGENT_KEY: 'agent',
        MOLTNET_GITHUB_APP_PRIVATE_KEY: 'app',
        GITHUB_TOKEN: 'wide',
        ADAPTIVE_DATABASE_URL: 'db',
        OPENAI_API_KEY: 'model',
      },
      'scoped',
    ),
  ).toEqual({ PATH: '/bin', HOME: '/home', GH_TOKEN: 'scoped' });
});
it('does not pass coordinator credentials to an actual gh subprocess', async () => {
  const root = mkdtempSync(join(tmpdir(), 'review-gh-env-'));
  dirs.push(root);
  const captured = join(root, 'captured.json');
  writeFileSync(
    join(root, 'gh'),
    `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(captured)},JSON.stringify({ app:process.env.MOLTNET_GITHUB_APP_PRIVATE_KEY, agent:process.env.MOLTNET_AGENT_KEY, provider:process.env.OPENAI_API_KEY, token:process.env.GH_TOKEN }));console.log(JSON.stringify({headRefOid:'head',baseRefOid:'base'}));`,
    { mode: 0o700 },
  );
  const deps = createReviewHostDeps(
    {
      PATH: `${root}:${process.env.PATH ?? ''}`,
      MOLTNET_GITHUB_APP_PRIVATE_KEY: 'app',
      MOLTNET_AGENT_KEY: 'agent',
      OPENAI_API_KEY: 'model',
    },
    root,
    () => Promise.resolve('scoped'),
  );
  expect(await deps.github.revisions('owner/repo', 1)).toEqual({
    head: 'head',
    base: 'base',
  });
  expect(JSON.parse(readFileSync(captured, 'utf8'))).toEqual({
    token: 'scoped',
  });
});

it('fetches missing PR objects without converting a complete local clone to a shallow clone', async () => {
  const root = mkdtempSync(join(tmpdir(), 'review-full-git-'));
  dirs.push(root);
  const source = join(root, 'source');
  const checkout = join(root, 'checkout');
  mkdirSync(source);
  mkdirSync(join(root, 'fixture'));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(source, 'init', '-q');
  git(source, 'config', 'user.name', 'Test');
  git(source, 'config', 'user.email', 'test@example.invalid');
  git(source, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(source, 'file'), 'base');
  git(source, 'add', '.');
  git(source, 'commit', '-qm', 'base');
  const base = git(source, 'rev-parse', 'HEAD');
  git(root, 'clone', '--bare', source, join(root, 'fixture/remote.git'));
  git(root, 'clone', `file://${root}/fixture/remote.git`, checkout);
  writeFileSync(join(source, 'file'), 'head');
  git(source, 'commit', '-qam', 'head');
  const head = git(source, 'rev-parse', 'HEAD');
  git(source, 'push', join(root, 'fixture/remote.git'), 'HEAD');
  expect(() => git(checkout, 'cat-file', '-e', `${head}^{tree}`)).toThrow();
  await ensureReviewGit(
    { repo: 'fixture/remote', base, head } as PinnedPullRequest,
    checkout,
    {
      PATH: process.env.PATH,
      HOME: root,
      GITHUB_SERVER_URL: `file://${root}`,
      GH_TOKEN: 'scoped',
    },
  );
  expect(git(checkout, 'rev-parse', '--is-shallow-repository')).toBe('false');
  expect(git(checkout, 'merge-base', base, head)).toBe(base);
});
