import console from 'node:console';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const dependencies = execFileSync(
  'cargo',
  [
    'tree',
    '--locked',
    '--manifest-path',
    `${root}/src-tauri/Cargo.toml`,
    '--edges',
    'normal',
    '--prefix',
    'none',
  ],
  { encoding: 'utf8' },
);
assert(
  !dependencies.includes('tauri-plugin-wdio'),
  'Release includes a WebDriver plugin',
);
await build({ configFile: `${root}/vite.config.ts` });
for (const file of await readdir(`${root}/dist/assets`)) {
  if (!file.endsWith('.js')) continue;
  const source = await readFile(`${root}/dist/assets/${file}`, 'utf8');
  for (const marker of ['wdioTauri', '__wdio_mocks__', 'desktop-e2e:mount']) {
    assert(!source.includes(marker), `Release renderer includes ${marker}`);
  }
}
console.log(
  'Release dependency graph and renderer exclude Desktop automation.',
);
