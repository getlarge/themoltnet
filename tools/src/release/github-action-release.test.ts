import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeLock } from './action-runtime-lock.js';
import { parsePublisherArgs } from './github-action-publisher.js';
import {
  authHeaderValue,
  missingBundleEntries,
  releaseProblems,
  stableMajorTagFor,
  tagPushCommand,
} from './github-action-release.js';

describe('stableMajorTagFor', () => {
  it.each([
    ['0.4.1', undefined, 'v0'],
    ['1.2.3', undefined, 'v1'],
    ['0.2.0', 'docs-impact-review-action-v', 'docs-impact-review-action-v0'],
    ['1.0.0', 'docs-impact-review-action-v', 'docs-impact-review-action-v1'],
  ])('%s with prefix %s moves %s', (version, prefix, expected) => {
    // Act / Assert
    expect(stableMajorTagFor(version, prefix)).toBe(expected);
  });

  it('rejects a version that is not semver', () => {
    // Act / Assert
    expect(() => stableMajorTagFor('latest')).toThrow('not semver');
  });
});

describe('missingBundleEntries', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'action-bundle-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'chunk.js'), '');
    writeFileSync(join(dir, 'review.js'), '');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('names every entry the bundle lacks, even when it holds chunks', () => {
    // Act / Assert
    expect(missingBundleEntries(dir, ['review.js', 'comment.js'])).toEqual([
      'comment.js',
    ]);
  });

  it('requires at least one entry', () => {
    // Act / Assert
    expect(() => missingBundleEntries(dir, [])).toThrow('--entries');
  });
});

describe('tagPushCommand', () => {
  it('force-pushes the tag with the ambient credentials by default', () => {
    // Act / Assert
    expect(tagPushCommand('v0')).toEqual({
      args: ['push', 'origin', 'refs/tags/v0:refs/tags/v0', '--force'],
      env: {},
    });
  });

  it('authenticates only this push through the environment, not argv', () => {
    // Act
    const command = tagPushCommand(
      'v0',
      'secret-token',
      'https://ghe.example.com',
    );

    // Assert
    expect(command.args.join(' ')).not.toContain('secret');
    expect(command.args.join(' ')).not.toContain(
      authHeaderValue('secret-token'),
    );
    expect(command.env).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://ghe.example.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from('x-access-token:secret-token').toString('base64')}`,
    });
  });
});

describe('releaseProblems', () => {
  let root: string;
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'action-release-'));
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');
    for (const dir of ['a/dist', 'b/dist']) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'main.js'), 'export {};\n');
    }
    writeFileSync(join(root, 'workflow.yml'), 'on: push\n');
    git('add', '-A');
    writeFileSync(join(root, 'a/runtime.lock'), computeLock(root, lock));
    git('add', '-A');
    git('commit', '-qm', 'init');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const lock = {
    lock: 'a/runtime.lock',
    pathspecs: ['workflow.yml', 'b/dist'],
  };
  const check = () =>
    releaseProblems({
      root,
      bundleDir: 'a/dist',
      entries: ['main.js'],
      otherBundleDirs: ['b/dist'],
      locks: [lock],
    });

  it('is ready when bundles are committed and locks current', () => {
    // Act / Assert
    expect(check()).toEqual([]);
  });

  it('refuses a missing entry point', () => {
    // Act
    const problems = releaseProblems({
      root,
      bundleDir: 'a/dist',
      entries: ['main.js', 'check.js'],
      locks: [lock],
    });

    // Assert
    expect(problems).toEqual(['a/dist lacks: check.js']);
  });

  it('refuses a bundle, this one or another it runs, that differs from its commit', () => {
    // Arrange
    writeFileSync(join(root, 'a/dist/chunk-new.js'), 'export {};\n');
    writeFileSync(join(root, 'b/dist/main.js'), 'export const x = 1;\n');

    // Act
    const problems = check();

    // Assert
    expect(problems[0]).toMatch(
      /^a\/dist does not match its sources:\n\?\? a\/dist\/chunk-new\.js/,
    );
    expect(problems[1]).toMatch(/^b\/dist does not match its sources:/);
  });

  it('refuses a stale runtime lock', () => {
    // Arrange
    writeFileSync(join(root, 'workflow.yml'), 'on: pull_request\n');
    git('commit', '-qam', 'change the workflow');

    // Act / Assert
    expect(check()).toEqual(['a/runtime.lock is out of date']);
  });
});

describe('parsePublisherArgs', () => {
  it('reads entries, other bundles, and the tag prefix', () => {
    // Act
    const options = parsePublisherArgs([
      '--project',
      '@themoltnet/docs-impact-review-action',
      '--entries',
      'prepare.js, review.js',
      '--also-verify',
      '@themoltnet/agent-daemon-action',
      '--stable-major-tag-prefix',
      'docs-impact-review-action-v',
    ]);

    // Assert
    expect(options).toMatchObject({
      entries: ['prepare.js', 'review.js'],
      alsoVerify: ['@themoltnet/agent-daemon-action'],
      stableMajorTagPrefix: 'docs-impact-review-action-v',
      dryRun: false,
    });
  });
});
