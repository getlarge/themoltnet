import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  missingBundleEntries,
  stableMajorTagFor,
  tagPushArgs,
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

describe('tagPushArgs', () => {
  it('force-pushes the tag with the ambient credentials by default', () => {
    // Act / Assert
    expect(tagPushArgs('v0')).toEqual([
      'push',
      'origin',
      'refs/tags/v0:refs/tags/v0',
      '--force',
    ]);
  });

  it('authenticates only this push when given a token', () => {
    // Act
    const args = tagPushArgs('v0', 'secret-token');

    // Assert
    expect(args.slice(0, 2)).toEqual([
      '-c',
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from('x-access-token:secret-token').toString('base64')}`,
    ]);
    expect(args.slice(2)).toEqual([
      'push',
      'origin',
      'refs/tags/v0:refs/tags/v0',
      '--force',
    ]);
  });
});
