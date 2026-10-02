/**
 * Runs the committed bundles the way action.yml does, with plain `node`.
 * Each entry point must run its command exactly once: a second, concurrent
 * run creates duplicate review tasks and writes a second JSON report.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe.each(['review', 'comment'])('dist/%s.js', (entry) => {
  it('runs its command once', () => {
    // No arguments: the command fails on its usage check before any I/O.
    const result = spawnSync(
      process.execPath,
      [resolve(packageRoot, 'dist', `${entry}.js`)],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr.match(/Usage:/g)).toHaveLength(1);
  });
});
