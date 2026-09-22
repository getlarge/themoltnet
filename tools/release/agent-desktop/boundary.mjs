import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

export function assertReleaseConfig(config) {
  assert(config.app?.withGlobalTauri !== true, 'Release enables global Tauri');
  assert(
    !config.build?.features?.some((feature) =>
      /desktop-e2e|wdio/.test(feature),
    ),
    'Release enables automation features',
  );
  assert(
    !/wdio(?:-webdriver)?:/.test(JSON.stringify(config)),
    'Release grants WebDriver permissions',
  );
}

export function assertReleaseArguments(args) {
  assert(
    !args.some((arg) => /^--(?:all-features|features)(?:=|$)|^-F/.test(arg)),
    'Release bundle enables optional features',
  );
}

export function assertReleaseArtifact(contents, name) {
  for (const marker of [
    // This environment lookup exists only inside the desktop-e2e Rust feature.
    'MOLTNET_DESKTOP_E2E_FIXTURE_ROOT',
    'wdioTauri',
    'wdio-webdriver',
    '__wdio_mocks__',
    'desktop_e2e_tab',
  ]) {
    assert(
      !contents.includes(Buffer.from(marker)),
      `${name} includes ${marker}`,
    );
  }
}
