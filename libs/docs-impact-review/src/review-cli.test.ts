import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runReviewCli } from './review-cli.js';

const SHA = 'a'.repeat(40);
const UUID = '00000000-0000-4000-8000-000000000001';
const REVIEW = ['--team', 't', '--diary', 'd', '--profile', 'p'];

describe('runReviewCli arguments', () => {
  let dir: string;
  let stderr: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'review-cli-'));
    stderr = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['no pull request', ['--repo', 'o/r', ...REVIEW], 'Usage:'],
    ['a review without a team', ['--repo', 'o/r', '--pr', '1'], 'Usage:'],
    [
      'a correlation id across pull requests',
      [
        '--repo',
        'o/r',
        '--pr',
        '1',
        '--pr',
        '2',
        ...REVIEW,
        '--correlation-id',
        UUID,
      ],
      'require exactly one --pr',
    ],
    [
      'a base revision without the head',
      ['--repo', 'o/r', '--pr', '1', ...REVIEW, '--base-sha', SHA],
      'must be given together',
    ],
    [
      'a correlation id that is not a UUID',
      ['--repo', 'o/r', '--pr', '1', ...REVIEW, '--correlation-id', 'mine'],
      'must be a UUID',
    ],
    ['--rescore without labels', ['--rescore', 'x.json'], 'requires --labels'],
  ])('refuses %s with exit 2', async (_label, args, message) => {
    // Act
    const code = await runReviewCli(args);

    // Assert
    expect(code).toBe(2);
    expect(stderr.join('')).toContain(message);
  });

  it('refuses an invalid --config before any work', async () => {
    // Arrange
    const config = join(dir, 'config.json');
    writeFileSync(config, JSON.stringify({ version: 1, unknown: true }));

    // Act
    const code = await runReviewCli([
      '--repo',
      'o/r',
      '--pr',
      '1',
      '--dry-run',
      '--config',
      config,
    ]);

    // Assert
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('unknown key "unknown"');
  });

  it('refuses a missing --config file', async () => {
    // Act
    const code = await runReviewCli([
      '--repo',
      'o/r',
      '--pr',
      '1',
      '--dry-run',
      '--config',
      join(dir, 'absent.json'),
    ]);

    // Assert
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('cannot read');
  });
});
