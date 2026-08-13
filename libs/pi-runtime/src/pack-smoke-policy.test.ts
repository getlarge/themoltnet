import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('packed analyzer smoke policy', () => {
  it('allows freshly published internal packages in its isolated consumer', () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const smokeScript = readFileSync(
      resolve(packageRoot, 'scripts/smoke-packed-analyzer.mjs'),
      'utf8',
    );

    expect(smokeScript).toContain(
      "const internalPackageReleaseAgeExclude = '@themoltnet/*';",
    );
    expect(smokeScript).toContain(
      'npm_config_minimum_release_age_exclude: internalPackageReleaseAgeExclude',
    );
  });
});
