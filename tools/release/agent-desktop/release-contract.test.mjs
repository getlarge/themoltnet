import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  AssetsNotReadyError,
  MANIFEST_NAME,
  buildManifest,
  describeAssets,
  expectedAssetNames,
  verifyPublishedAssets,
} from './release-contract.mjs';

const VERSION = '1.2.3';
let directory;

function writeRelease() {
  for (const name of expectedAssetNames(VERSION)) {
    writeFileSync(
      join(directory, name),
      name.endsWith('.sig') ? `signature-of-${name}` : `bytes-of-${name}`,
    );
  }
}

const asPublished = (assets) =>
  assets.map(({ name, size, sha256 }) => ({
    name,
    size,
    state: 'uploaded',
    digest: `sha256:${sha256}`,
  }));

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'desktop-release-contract-'));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('describeAssets', () => {
  it('describes the complete release', () => {
    writeRelease();
    const assets = describeAssets(directory, VERSION);
    assert.deepEqual(
      assets.map(({ name }) => name),
      expectedAssetNames(VERSION),
    );
    assert.ok(assets.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)));
  });

  it('refuses a missing platform file', () => {
    writeRelease();
    rmSync(join(directory, `MoltNet-Agent_${VERSION}_amd64.deb`));
    assert.throws(
      () => describeAssets(directory, VERSION),
      /missing MoltNet-Agent_1\.2\.3_amd64\.deb; extra none/,
    );
  });

  it('refuses an unexpected file', () => {
    writeRelease();
    writeFileSync(join(directory, 'stale_1.2.2_amd64.deb'), 'old');
    assert.throws(
      () => describeAssets(directory, VERSION),
      /extra stale_1\.2\.2_amd64\.deb/,
    );
  });

  it('refuses an empty file', () => {
    writeRelease();
    writeFileSync(join(directory, `MoltNet-Agent_${VERSION}_aarch64.dmg`), '');
    assert.throws(() => describeAssets(directory, VERSION), /is empty/);
  });

  it('requires the manifest only when asked', () => {
    writeRelease();
    assert.throws(
      () => describeAssets(directory, VERSION, { withManifest: true }),
      /missing latest\.json/,
    );
  });

  it('refuses a non-canonical version', () => {
    assert.throws(() => describeAssets(directory, 'v1.2.3'), /not canonical/);
  });
});

describe('buildManifest', () => {
  it('lists every updater target with its signature and download URL', () => {
    writeRelease();
    const manifest = buildManifest(
      directory,
      VERSION,
      'getlarge/themoltnet',
      '2026-01-01T00:00:00.000Z',
    );
    assert.deepEqual(Object.keys(manifest.platforms).sort(), [
      'darwin-aarch64',
      'linux-x86_64-appimage',
      'linux-x86_64-deb',
    ]);
    assert.deepEqual(manifest.platforms['linux-x86_64-deb'], {
      signature: `signature-of-MoltNet-Agent_${VERSION}_amd64.deb.sig`,
      url: `https://github.com/getlarge/themoltnet/releases/download/agent-desktop-v${VERSION}/MoltNet-Agent_${VERSION}_amd64.deb`,
    });
  });

  it('refuses an empty updater signature', () => {
    writeRelease();
    writeFileSync(
      join(directory, `MoltNet-Agent_${VERSION}_amd64.AppImage.sig`),
      '\n',
    );
    assert.throws(
      () => buildManifest(directory, VERSION, 'getlarge/themoltnet', ''),
      /Missing updater signature: .*AppImage/,
    );
  });
});

describe('verifyPublishedAssets', () => {
  let local;
  beforeEach(() => {
    writeRelease();
    writeFileSync(join(directory, MANIFEST_NAME), '{}\n');
    local = describeAssets(directory, VERSION, { withManifest: true });
  });

  it('accepts an identical published set', () => {
    verifyPublishedAssets(local, asPublished(local));
  });

  it('reports an unprocessed asset as not ready', () => {
    const published = asPublished(local);
    published[0].digest = null;
    assert.throws(
      () => verifyPublishedAssets(local, published),
      AssetsNotReadyError,
    );
    published[0].digest = `sha256:${local[0].sha256}`;
    published[0].state = 'starter';
    assert.throws(
      () => verifyPublishedAssets(local, published),
      AssetsNotReadyError,
    );
  });

  for (const [failure, mutate, message] of [
    ['missing', (p) => p.shift(), /missing .*; extra none/],
    [
      'extra',
      (p) => p.push({ name: 'unexpected.bin', size: 1, state: 'uploaded' }),
      /extra unexpected\.bin/,
    ],
    ['duplicate', (p) => p.push({ ...p[0] }), /duplicate asset names/],
    ['size', (p) => (p[0].size += 1), /size differs/],
    [
      'digest',
      (p) => (p[0].digest = `sha256:${'0'.repeat(64)}`),
      /digest differs/,
    ],
  ]) {
    it(`refuses a ${failure} asset as a hard failure`, () => {
      const published = asPublished(local);
      mutate(published);
      assert.throws(
        () => verifyPublishedAssets(local, published),
        (error) =>
          !(error instanceof AssetsNotReadyError) &&
          message.test(error.message),
      );
    });
  }
});
