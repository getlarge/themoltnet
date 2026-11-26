import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const store = join(root, 'node_modules/.pnpm');
// Exercise locked consumers, not orphaned versions in a reused virtual store.
// Audit/dedupe checks cannot verify their CommonJS/ESM export compatibility.
const versions = new Set(
  parseAllDocuments(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).flatMap(
    (document) =>
      Object.keys(document.toJSON().packages ?? {})
        .filter((key) => key.startsWith('minimatch@'))
        .map((key) => key.slice('minimatch@'.length)),
  ),
);
const packages = [...versions]
  .sort()
  .map((version) =>
    join(store, `minimatch@${version}`, 'node_modules/minimatch/package.json'),
  );

const pattern = 'src/{index,other}.{js,ts}';

describe('installed Minimatch / brace-expansion compatibility', () => {
  it('finds installed consumers to exercise', () => {
    expect(packages.length).toBeGreaterThan(0);
  });

  for (const packageFile of packages) {
    const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));

    it(`Minimatch ${pkg.version} expands braces through its CommonJS entry`, () => {
      const require = createRequire(packageFile);
      const loaded = require('minimatch');
      const match = typeof loaded === 'function' ? loaded : loaded.minimatch;

      expect(match('src/index.ts', pattern)).toBe(true);
      expect(match('src/other.js', pattern)).toBe(true);
      expect(match('src/missing.ts', pattern)).toBe(false);
    });

    it(`Minimatch ${pkg.version} loads and expands through its ESM entry`, () => {
      const entry = pkg.exports?.['.']?.import?.default ?? pkg.main;
      const entryUrl = pathToFileURL(resolve(dirname(packageFile), entry)).href;
      // A child process provides a fresh native ESM graph. Static import also
      // catches incompatible default/named exports before any matcher runs.
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import assert from 'node:assert/strict';
import * as loaded from ${JSON.stringify(entryUrl)};
const match = typeof loaded.default === 'function' ? loaded.default : loaded.minimatch;
assert.equal(match('src/index.ts', ${JSON.stringify(pattern)}), true);
assert.equal(match('src/other.js', ${JSON.stringify(pattern)}), true);
assert.equal(match('src/missing.ts', ${JSON.stringify(pattern)}), false);`,
        ],
        { timeout: 5000, stdio: 'pipe' },
      );
    });
  }
});
