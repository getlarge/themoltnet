import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeLock } from '../../src/release/action-runtime-lock.js';
import { parsePublisherArgs } from '../../src/release/github-action-publisher.js';
import {
  authHeaderValue,
  bundleTagFor,
  createReleaseCommit,
  missingBundleEntries,
  publishBundleTags,
  releaseProblems,
  stableMajorTagFor,
  tagPushCommand,
} from '../../src/release/github-action-release.js';

describe('stableMajorTagFor', () => {
  it.each([
    ['0.4.1', undefined, 'v0'],
    ['1.2.3', undefined, 'v1'],
    ['0.2.0', 'agent-daemon-action-v', 'agent-daemon-action-v0'],
    ['1.0.0', 'agent-daemon-action-v', 'agent-daemon-action-v1'],
  ])('%s with prefix %s moves %s', (version, prefix, expected) => {
    // Act / Assert
    expect(stableMajorTagFor(version, prefix)).toBe(expected);
  });

  it('rejects a version that is not semver', () => {
    // Act / Assert
    expect(() => stableMajorTagFor('latest')).toThrow('not semver');
  });
});

describe('bundleTagFor', () => {
  const commit = 'e81a938c96a624c78b8168f834a821c80f6a4d79';

  it('names the version and commit outside the version-tag namespace', () => {
    // Act / Assert
    expect(bundleTagFor('0.3.0', 'adaptive-review-action-v', commit)).toBe(
      'bundles/adaptive-review-action-v0.3.0-e81a938c96a6',
    );
  });

  it('rejects an abbreviated commit', () => {
    // Act / Assert
    expect(() => bundleTagFor('0.3.0', 'v', 'e81a938')).toThrow('full SHA');
  });

  it('rejects a version that is not semver', () => {
    // Act / Assert
    expect(() => bundleTagFor('latest', 'v', commit)).toThrow('not semver');
  });
});

describe('missingBundleEntries', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'action-bundle-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'chunk.js'), '');
    writeFileSync(join(dir, 'review.js'), 'export {};');
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

  it('rejects an empty entry as well as an absent entry', () => {
    writeFileSync(join(dir, 'empty.js'), '');
    expect(missingBundleEntries(dir, ['empty.js', 'absent.js'])).toEqual([
      'empty.js',
      'absent.js',
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
      args: ['push', '--atomic', 'origin', '+refs/tags/v0:refs/tags/v0'],
      env: {},
    });
  });

  it('creates kept tags without force in the same atomic push', () => {
    // Act
    const command = tagPushCommand('v0', undefined, undefined, [
      'bundles/v0.3.0-e81a938c96a6',
    ]);

    // Assert
    expect(command.args).toEqual([
      'push',
      '--atomic',
      'origin',
      'refs/tags/bundles/v0.3.0-e81a938c96a6:refs/tags/bundles/v0.3.0-e81a938c96a6',
      '+refs/tags/v0:refs/tags/v0',
    ]);
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
    git('config', 'tag.gpgsign', 'false');
    for (const dir of ['a/dist', 'b/dist']) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'main.js'), 'export {};\n');
    }
    writeFileSync(join(root, 'workflow.yml'), 'on: push\n');
    writeFileSync(join(root, '.gitignore'), '**/dist/\n');
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
    pathspecs: ['workflow.yml'],
  };
  const check = () =>
    releaseProblems({
      root,
      bundleDir: 'a/dist',
      entries: ['main.js'],
      otherBundleDirs: ['b/dist'],
      locks: [lock],
    });

  it('is ready when bundles are ignored and locks current', () => {
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

  it('accepts newly built chunks without requiring tracked dist files', () => {
    writeFileSync(join(root, 'a/dist/chunk-new.js'), 'export {};\n');
    writeFileSync(join(root, 'b/dist/main.js'), 'export const x = 1;\n');
    expect(check()).toEqual([]);
  });

  it('refuses an absent included bundle', () => {
    rmSync(join(root, 'b/dist'), { recursive: true });
    expect(check()).toEqual(['b/dist is missing']);
  });

  it('adds both bundles only to a detached commit and moves only the major tag', () => {
    const source = git('rev-parse', 'HEAD').trim();
    const branch = git('branch', '--show-current').trim();
    git('tag', 'action-v0.1.0');
    git('checkout', '--detach', 'action-v0.1.0');

    const target = createReleaseCommit(
      root,
      ['a/dist', 'b/dist'],
      'chore(actions): bundle',
    );
    git('tag', '-f', 'action-v0', target);

    expect(target).not.toBe(source);
    expect(git('rev-parse', `${target}^`).trim()).toBe(source);
    expect(git('rev-parse', 'action-v0.1.0').trim()).toBe(source);
    expect(git('rev-parse', branch).trim()).toBe(source);
    expect(git('rev-parse', 'action-v0').trim()).toBe(target);
    expect(
      git('diff-tree', '--no-commit-id', '--name-only', '-r', target)
        .trim()
        .split('\n'),
    ).toEqual(['a/dist/main.js', 'b/dist/main.js']);
  });

  it('refuses to create a release commit on a branch', () => {
    expect(() => createReleaseCommit(root, ['a/dist'], 'bundle')).toThrow(
      'detached HEAD',
    );
  });

  it('refuses to include unrelated staged changes', () => {
    git('checkout', '--detach');
    writeFileSync(join(root, 'unrelated.txt'), 'unrelated');
    git('add', 'unrelated.txt');
    expect(() => createReleaseCommit(root, ['a/dist'], 'bundle')).toThrow(
      'clean tracked checkout',
    );
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
      '@themoltnet/example-action',
      '--entries',
      'prepare.js, review.js',
      '--also-include',
      '@themoltnet/agent-daemon-action',
      '--stable-major-tag-prefix',
      'agent-daemon-action-v',
    ]);

    // Assert
    expect(options).toMatchObject({
      entries: ['prepare.js', 'review.js'],
      alsoInclude: ['@themoltnet/agent-daemon-action'],
      stableMajorTagPrefix: 'agent-daemon-action-v',
      dryRun: false,
    });
  });
});

// Real Git subprocesses can exceed Vitest's 5s unit-test budget on busy CI hosts.
describe(
  'immutable publication against a real Git remote',
  { timeout: 30_000 },
  () => {
    let root: string;
    let remote: string;
    let source: string;
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
    const projectRoot = 'packages/agent-daemon-action';
    const publish = (version = '0.8.0') =>
      publishBundleTags({
        root,
        project: '@themoltnet/agent-daemon-action',
        projectRoot,
        version,
        prefix: 'v',
        bundleDir: `${projectRoot}/dist`,
        bundleDirs: [`${projectRoot}/dist`],
        entries: ['main.js'],
      });
    const resetSource = () => git('checkout', '--detach', '-f', source);
    const remoteSha = (tag: string) =>
      git('ls-remote', 'origin', `refs/tags/${tag}`).split(/\s/)[0];
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'action-push-'));
      remote = join(root, 'remote.git');
      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'test');
      git('config', 'commit.gpgsign', 'false');
      git('config', 'tag.gpgsign', 'false');
      git('init', '--bare', remote);
      git('remote', 'add', 'origin', remote);
      mkdirSync(join(root, projectRoot, 'dist'), { recursive: true });
      writeFileSync(
        join(root, projectRoot, 'package.json'),
        JSON.stringify({ version: '0.8.0' }),
      );
      writeFileSync(join(root, projectRoot, 'dist/main.js'), 'export {};\n');
      writeFileSync(join(root, '.gitignore'), '**/dist/\nremote.git/\n');
      git('add', '.');
      git('commit', '-qm', 'source');
      source = git('rev-parse', 'HEAD');
      git('tag', 'agent-daemon-action-v0.8.0');
      git('push', 'origin', 'refs/tags/agent-daemon-action-v0.8.0');
      resetSource();
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('retains source history, publishes immutable identity, and reuses it on retry', () => {
      const first = publish();
      expect(remoteSha('bundles/agent-daemon-action-v0.8.0')).toBe(first);
      expect(remoteSha('v0')).toBe(first);
      expect(remoteSha('agent-daemon-action-v0.8.0')).toBe(source);
      resetSource();
      mkdirSync(join(root, projectRoot, 'dist'), { recursive: true });
      writeFileSync(
        join(root, projectRoot, 'dist/main.js'),
        'different rebuild bytes',
      );
      expect(publish()).toBe(first);
    });

    it('recovers a rejected atomic push without leaving a remote bundle or alias', () => {
      const hook = join(remote, 'hooks/pre-receive');
      writeFileSync(hook, '#!/bin/sh\nexit 1\n');
      chmodSync(hook, 0o755);
      expect(() => publish()).toThrow();
      expect(remoteSha('bundles/agent-daemon-action-v0.8.0')).toBe('');
      expect(remoteSha('v0')).toBe('');
      rmSync(hook);
      resetSource();
      // checkout removes tracked dist; reconstruct the build output.
      mkdirSync(join(root, projectRoot, 'dist'), { recursive: true });
      writeFileSync(join(root, projectRoot, 'dist/main.js'), 'export {};\n');
      expect(remoteSha('v0')).toBe('');
      expect(publish()).toBe(remoteSha('v0'));
    });

    it('can retain an older exact version without moving a newer major backwards', () => {
      const old = publish();
      resetSource();
      writeFileSync(
        join(root, projectRoot, 'package.json'),
        JSON.stringify({ version: '0.9.0' }),
      );
      git('add', projectRoot);
      git('commit', '-qm', 'new version');
      mkdirSync(join(root, projectRoot, 'dist'), { recursive: true });
      writeFileSync(
        join(root, projectRoot, 'dist/main.js'),
        'export const newer = true;\n',
      );
      const newer = publish('0.9.0');
      resetSource();
      expect(publish()).toBe(old);
      expect(remoteSha('v0')).toBe(newer);
    });

    it('adopts a legacy major bundle and anchors it before a later promotion', () => {
      const old = publish();
      git(
        'push',
        'origin',
        ':refs/tags/bundles/agent-daemon-action-v0.8.0',
        `:refs/tags/${bundleTagFor('0.8.0', 'v', old)}`,
      );
      resetSource();
      expect(publish()).toBe(old);
      expect(remoteSha('bundles/agent-daemon-action-v0.8.0')).toBe(old);
      expect(remoteSha(bundleTagFor('0.8.0', 'v', old))).toBe(old);
    });

    it('a stale promotion lease rejects the whole push, including new immutable tags', () => {
      const current = publish();
      writeFileSync(join(root, 'new-file'), 'new');
      git('add', 'new-file');
      git('commit', '-qm', 'concurrent target');
      git('tag', 'candidate');
      git('tag', '-f', 'v0');
      const command = tagPushCommand(
        'v0',
        undefined,
        undefined,
        ['candidate'],
        '0'.repeat(40),
      );
      expect(() => git(...command.args)).toThrow();
      expect(remoteSha('candidate')).toBe('');
      expect(remoteSha('v0')).toBe(current);
    });

    it('rejects an immutable mapping whose source parent differs', () => {
      publish();
      resetSource();
      writeFileSync(join(root, 'unrelated'), 'change');
      git('add', 'unrelated');
      git('commit', '-qm', 'different source');
      expect(() => publish()).toThrow('does not descend directly');
    });
  },
);
