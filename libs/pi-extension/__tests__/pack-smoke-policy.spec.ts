import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('pi loader pack smoke policy', () => {
  it('skips registry-dependent work when pre-merge CI requests it', () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const smokeScript = resolve(packageRoot, 'scripts/smoke-pi-loader.mjs');

    const result = spawnSync(process.execPath, [smokeScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MOLTNET_SKIP_REGISTRY_SMOKE: '1',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      'Skipped registry install smoke (MOLTNET_SKIP_REGISTRY_SMOKE=1)\n',
    );
  });
});
