import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, test } from 'vitest';

import { checkBuildAssets } from '../check-build-assets.mjs';

let directory;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'build-assets-'));
  mkdirSync(join(directory, 'dist'));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function source(name, content) {
  writeFileSync(join(directory, name), content);
}
function output(name, content) {
  writeFileSync(join(directory, 'dist', name), content);
}

test('accepts identical README, CHANGELOG, and other root Markdown bytes', () => {
  for (const name of ['README.md', 'CHANGELOG.md', 'NOTES.md']) {
    source(name, '\ufeff# Content\r\n\r\n🦞\r\n');
    output(name, '\ufeff# Content\r\n\r\n🦞\r\n');
  }
  source('not-an-asset.txt', 'ignored');
  assert.deepEqual(checkBuildAssets(directory), []);
});

test('rejects missing build output', () => {
  source('README.md', 'readme');
  assert.match(
    checkBuildAssets(directory)[0],
    /Missing build asset: .*README.md/,
  );
});

test('rejects content and newline changes rather than normalizing text', () => {
  source('CHANGELOG.md', '# Changes\r\n');
  output('CHANGELOG.md', '# Changes\n');
  assert.match(
    checkBuildAssets(directory)[0],
    /differs from source: .*CHANGELOG.md/,
  );
});

test('refuses a vacuous pass when no source assets exist', () => {
  assert.match(checkBuildAssets(directory)[0], /No root Markdown assets/);
});
