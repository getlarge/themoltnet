import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const entry = fileURLToPath(
  new URL('../src/diary-runtime.ts', import.meta.url),
);
const loader = createRequire(import.meta.url).resolve('tsx');
it.each([
  ['["00000000-0000-4000-8000-000000000001"]', true],
  ['[]', false],
])(
  'initializes the optional focused runtime only with execution-time diary IDs (%s)',
  (ids, valid) => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        loader,
        '--input-type=module',
        '-e',
        `import adapter from ${JSON.stringify(entry)}; process.stdout.write(adapter.runtimeKind);`,
      ],
      {
        env: { ...process.env, ADAPTIVE_REVIEW_DIARY_IDS: ids },
        encoding: 'utf8',
        // Bound real daemon-adapter startup independently of Vitest's timer.
        timeout: 10_000,
        killSignal: 'SIGKILL',
      },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(valid ? 0 : 1);
    if (valid) expect(result.stdout).toBe('adaptive_review_pi');
    else expect(result.stderr).toContain('Review diary sources must contain');
  },
  15_000,
);
