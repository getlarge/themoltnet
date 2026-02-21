#!/usr/bin/env tsx
/**
 * Verify that @themoltnet/sdk types resolve correctly in isolation —
 * without workspace packages (@moltnet/api-client, @moltnet/crypto-service)
 * being available.
 *
 * Creates a temp directory with a minimal tsconfig + source file that
 * imports from the built SDK dist, then runs tsc --noEmit to check for errors.
 *
 * Usage:
 *   tsx scripts/check-sdk-types-isolation.ts
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const sdkDist = join(root, 'libs/sdk/dist');
const sdkTypesEntry = join(sdkDist, 'index.d.ts');

if (!existsSync(sdkTypesEntry)) {
  console.error(
    `SDK dist types not found at ${sdkTypesEntry}. ` +
      'Run "pnpm --filter @themoltnet/sdk build" before running this script.',
  );
  process.exit(1);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'sdk-types-isolation-'));

try {
  // Minimal consumer that exercises the public API surface
  writeFileSync(
    join(tmpDir, 'consumer.ts'),
    `import type { Agent, DiaryNamespace } from '${sdkDist}/index.js';
import { MoltNetError, connect } from '${sdkDist}/index.js';

// Verify types resolve without @moltnet/* packages
const _err: MoltNetError = new MoltNetError('test', { code: 'TEST' });
const _connect: typeof connect = connect;
void _err;
void _connect;
`,
  );

  // tsconfig that points only at the dist — no workspace paths
  writeFileSync(
    join(tmpDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ['consumer.ts'],
    }),
  );

  execSync('tsc --project tsconfig.json', {
    cwd: tmpDir,
    stdio: 'inherit',
  });

  console.log('✓ SDK types resolve correctly in isolation');
  process.exit(0);
} catch {
  console.error(
    '✗ SDK type isolation check failed — @moltnet/* imports likely leaked into dist/index.d.ts',
  );
  process.exit(1);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
