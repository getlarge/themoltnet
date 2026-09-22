import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { test } from 'node:test';

import {
  assertReleaseConfig,
  assertReleaseArtifact,
  assertReleaseArguments,
} from './boundary.mjs';

test('rejects automation in base, platform, and merged release configuration', () => {
  for (const config of [
    { build: { features: ['desktop-e2e'] } },
    { build: { features: ['tauri-plugin-wdio'] } },
    { app: { withGlobalTauri: true } },
    {
      app: { security: { capabilities: [{ permissions: ['wdio:default'] }] } },
    },
  ])
    assert.throws(() => assertReleaseConfig(config));
  assertReleaseConfig({ bundle: { createUpdaterArtifacts: true } });
});

test('rejects every Cargo feature flag spelling in release arguments', () => {
  for (const args of [
    ['--features', 'desktop-e2e'],
    ['--features=desktop-e2e'],
    ['-F', 'desktop-e2e'],
    ['-Fdesktop-e2e'],
    ['--all-features'],
  ]) {
    assert.throws(() => assertReleaseArguments(args));
  }
  assertReleaseArguments([
    '--bundles',
    'app,dmg',
    '--target',
    'aarch64-apple-darwin',
  ]);
});

test('checks feature-exclusive native markers as well as renderer hooks', () => {
  for (const marker of [
    'MOLTNET_DESKTOP_E2E_FIXTURE_ROOT',
    'wdio-webdriver',
    '__wdio_mocks__',
    'desktop-e2e:mount',
  ]) {
    assert.throws(() =>
      assertReleaseArtifact(Buffer.from(`prefix ${marker} suffix`), 'fixture'),
    );
  }
  assertReleaseArtifact(Buffer.from('ordinary production artifact'), 'fixture');
});

test('validates runtime release overlays and all feature flags before packaging', () => {
  const verifier = fileURLToPath(
    new URL('./verify-boundary.mjs', import.meta.url),
  );
  const run = (args = [], config = '{}') =>
    execFileSync(process.execPath, [verifier, '--config-only', '--', ...args], {
      env: { ...process.env, TAURI_CONFIG: config },
      stdio: 'pipe',
    });
  assert.doesNotThrow(() =>
    run(['--config', '{"bundle":{"createUpdaterArtifacts":false}}']),
  );
  assert.throws(() => run([], '{"build":{"features":["desktop-e2e"]}}'));
  assert.throws(() => run(['--config', '{"app":{"withGlobalTauri":true}}']));
  for (const flag of [
    '--features=desktop-e2e',
    '-Fdesktop-e2e',
    '--all-features',
  ])
    assert.throws(() => run([flag]));
});
