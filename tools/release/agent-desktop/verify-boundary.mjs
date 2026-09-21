import console from 'node:console';
import process from 'node:process';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(
  new URL('../../../apps/agent-desktop', import.meta.url),
);
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
const config = JSON.parse(
  await readFile(`${root}/src-tauri/tauri.conf.json`, 'utf8'),
);
assert(config.app?.withGlobalTauri !== true, 'Release enables global Tauri');
for (const contents of [
  JSON.stringify(config),
  ...(await Promise.all(
    (await readdir(`${root}/src-tauri/capabilities`))
      .filter((name) => name.endsWith('.json'))
      .map((name) =>
        readFile(`${root}/src-tauri/capabilities/${name}`, 'utf8'),
      ),
  )),
]) {
  assert(
    !/wdio(?:-webdriver)?:/.test(contents),
    'Release grants WebDriver permissions',
  );
}
const bundleScript = await readFile(
  new URL('./bundle.sh', import.meta.url),
  'utf8',
);
assert(
  !/--features(?:[=\s])/.test(bundleScript),
  'Release bundle enables optional features',
);
for (const file of await readdir(`${root}/dist/assets`)) {
  if (!file.endsWith('.js')) continue;
  const source = await readFile(`${root}/dist/assets/${file}`, 'utf8');
  for (const marker of [
    'wdioTauri',
    '__wdio_mocks__',
    'desktop-e2e:mount',
    'desktop_e2e_tab',
  ]) {
    assert(!source.includes(marker), `Release renderer includes ${marker}`);
  }
}
// Compile the ordinary native binary as well: a feature-gated key command
// must disappear from registration and generated IPC dispatch in this build.
execFileSync(
  'cargo',
  [
    'build',
    '--locked',
    '--manifest-path',
    `${root}/src-tauri/Cargo.toml`,
    '--target-dir',
    `${root}/out-rust/test`,
  ],
  { stdio: 'inherit' },
);
const binary = await readFile(
  `${root}/out-rust/test/debug/moltnet-agent-desktop${process.platform === 'win32' ? '.exe' : ''}`,
);
for (const marker of ['desktop_e2e_tab', '__wdio_mocks__', 'wdio-webdriver']) {
  assert(
    !binary.includes(Buffer.from(marker)),
    `Release native binary includes ${marker}`,
  );
}
console.log(
  'Release dependency graph, native binary, and renderer exclude Desktop automation.',
);
