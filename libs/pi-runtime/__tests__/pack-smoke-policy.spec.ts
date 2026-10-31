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

import { expect, it } from 'vitest';

it('copies release quarantine and exact exceptions into isolated consumers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-policy-'));
  try {
    const consumer = join(dir, 'consumer');
    mkdirSync(consumer);
    writeFileSync(
      join(dir, 'pnpm-workspace.yaml'),
      "packages:\n  - libs/*\nminimumReleaseAge: 1440\nminimumReleaseAgeExclude:\n  - '@earendil-works/pi-ai@1.0.0'\n  - '@themoltnet/*'\nallowBuilds:\n  esbuild: true\n",
    );
    const helper = new URL('../../../pack.shared.mjs', import.meta.url).href;
    execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { writePackedConsumerPolicy } from ${JSON.stringify(helper)}; writePackedConsumerPolicy(process.argv[1], process.argv[2]);`,
      dir,
      consumer,
    ]);
    expect(readFileSync(join(consumer, 'pnpm-workspace.yaml'), 'utf8')).toBe(
      "minimumReleaseAge: 1440\nminimumReleaseAgeExclude:\n  - '@earendil-works/pi-ai@1.0.0'\n  - '@themoltnet/*'\n",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
