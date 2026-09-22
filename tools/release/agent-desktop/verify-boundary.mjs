import console from 'node:console';
import process from 'node:process';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, URL } from 'node:url';

import {
  assertReleaseArtifact,
  assertReleaseArguments,
  assertReleaseConfig,
} from './boundary.mjs';

const root = fileURLToPath(
  new URL('../../../apps/agent-desktop', import.meta.url),
);
const { values, positionals } = parseArgs({
  options: { 'config-only': { type: 'boolean' }, binary: { type: 'string' } },
  allowPositionals: true,
});
assertReleaseArguments(positionals);
// Validate every release overlay, including the dynamically supplied updater
// configuration. Tauri resolves --config paths relative to the Desktop project.
const configFiles = (await readdir(`${root}/src-tauri`)).filter((file) =>
  /^tauri(?:\.(?:linux|macos|windows))?\.conf\.json$/.test(file),
);
const configs = await Promise.all(
  configFiles.map((file) => readFile(`${root}/src-tauri/${file}`, 'utf8')),
);
if (process.env.TAURI_CONFIG) configs.push(process.env.TAURI_CONFIG);
for (let i = 0; i < positionals.length; i++) {
  const arg = positionals[i];
  const config =
    arg === '--config' || arg === '-c'
      ? positionals[++i]
      : arg.startsWith('--config=')
        ? arg.slice('--config='.length)
        : undefined;
  if (config !== undefined)
    configs.push(
      config.trimStart().startsWith('{')
        ? config
        : await readFile(
            isAbsolute(config) ? config : resolve(root, config),
            'utf8',
          ),
    );
}
for (const config of configs) assertReleaseConfig(JSON.parse(config));
for (const file of await readdir(`${root}/src-tauri/capabilities`)) {
  if (file.endsWith('.json'))
    assertReleaseConfig(
      JSON.parse(
        await readFile(`${root}/src-tauri/capabilities/${file}`, 'utf8'),
      ),
    );
}
if (!values['config-only']) {
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
  for (const file of await readdir(`${root}/dist/assets`)) {
    if (file.endsWith('.js'))
      assertReleaseArtifact(
        await readFile(`${root}/dist/assets/${file}`),
        `Release renderer ${file}`,
      );
  }
  // The Nx build target restores this binary on a cache hit. Packaging passes
  // its actual target binary, so checking a second debug build is unnecessary.
  const binary =
    values.binary ??
    `${root}/out-rust/build/release/moltnet-agent-desktop${process.platform === 'win32' ? '.exe' : ''}`;
  assertReleaseArtifact(await readFile(binary), 'Release native binary');
}
console.log('Release configuration and artifacts exclude Desktop automation.');
