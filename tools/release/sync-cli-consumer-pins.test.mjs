import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  advancePin,
  compareVersions,
  main,
  pinFiles,
  publishedPin,
  verifyPackages,
  waitForPackages,
} from './sync-cli-consumer-pins.mjs';

test('compares numeric versions and rejects malformed versions', () => {
  assert.equal(compareVersions('3.10.0', '3.9.9'), 1);
  assert.equal(compareVersions('3.5.0', '3.5.0'), 0);
  assert.equal(compareVersions('3.4.9', '3.5.0'), -1);
  assert.throws(() => compareVersions('3.5.0-beta', '3.5.0'));
});

test('waits for npm to expose the released version', async () => {
  let attempts = 0;
  const delays = [];
  await waitForPackages(
    '3.7.0',
    async () => {
      attempts++;
      return {
        ok: attempts > 1,
        status: attempts > 1 ? 200 : 404,
        json: async () => ({ version: '3.7.0' }),
      };
    },
    async (ms) => delays.push(ms),
    3,
  );
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [15_000]);
});

test('stops after the visibility window expires', async () => {
  let attempts = 0;
  await assert.rejects(
    waitForPackages(
      '3.7.0',
      async () => {
        attempts++;
        return { ok: false, status: 404 };
      },
      async () => {},
      3,
    ),
    /cli@3.7.0 unavailable \(404\)/,
  );
  assert.equal(attempts, 3);
});

test('advances only newer pins and is idempotent', () => {
  const source = "const MOLTNET_CLI_VERSION = '3.5.0';";
  const advanced = advancePin(source, '3.6.0');
  assert.equal(advanced, "const MOLTNET_CLI_VERSION = '3.6.0';");
  assert.equal(advancePin(advanced, '3.6.0'), advanced);
  assert.equal(advancePin(advanced, '3.5.0'), advanced);
});

test('advances workflow pins without changing surrounding YAML', () => {
  const source = "env:\n  MOLTNET_CLI_VERSION: '3.15.0' # published\n";
  assert.equal(
    advancePin(source, '3.19.0'),
    "env:\n  MOLTNET_CLI_VERSION: '3.19.0' # published\n",
  );
  assert.equal(advancePin(source, '3.14.0'), source);
  assert.throws(() => advancePin('env: {}', '3.19.0'), /CLI pin not found/);
});

test('requires all three published packages', async () => {
  const visited = [];
  await verifyPackages('3.5.0', async (url) => {
    visited.push(url);
    return { ok: true, json: async () => ({ version: '3.5.0' }) };
  });
  assert.equal(visited.length, 3);
  await assert.rejects(
    verifyPackages('3.5.0', async (url) => ({
      ok: !url.includes('arm64'),
      status: 404,
      json: async () => ({ version: '3.5.0' }),
    })),
    /cli-linux-arm64@3.5.0 unavailable/,
  );
});

const currentPin = "const MOLTNET_CLI_VERSION = '3.11.0';";

test('uses the published dist-tag and verifies exact platform versions', async () => {
  const visited = [];
  const updated = await publishedPin(currentPin, async (url) => {
    visited.push(url);
    return { ok: true, json: async () => ({ version: '3.12.0' }) };
  });
  assert.equal(updated, "const MOLTNET_CLI_VERSION = '3.12.0';");
  assert.equal(visited.length, 4);
  assert.ok(visited[0].endsWith('/latest'));
  assert.ok(visited.slice(1).every((url) => url.endsWith('/3.12.0')));
});

test('retains the pin during partial npm publication', async () => {
  const updated = await publishedPin(currentPin, async (url) => ({
    ok: !url.includes('arm64'),
    status: url.includes('arm64') ? 404 : 200,
    json: async () => ({ version: '3.12.0' }),
  }));
  assert.equal(updated, currentPin);
});

test('never rolls back a newer pin or queries platforms for an unchanged pin', async () => {
  for (const version of ['3.10.0', '3.11.0']) {
    let requests = 0;
    assert.equal(
      await publishedPin(currentPin, async () => {
        requests++;
        return { ok: true, json: async () => ({ version }) };
      }),
      currentPin,
    );
    assert.equal(requests, 1);
  }
});

test('fails closed on registry errors and inconsistent metadata', async () => {
  await assert.rejects(
    publishedPin(currentPin, async () => ({ ok: false, status: 503 })),
    /Cannot resolve/,
  );
  await assert.rejects(
    publishedPin(currentPin, async (url) => ({
      ok: true,
      json: async () => ({
        version: url.endsWith('/latest') ? '3.12.0' : '3.11.0',
      }),
    })),
    /resolved 3.11.0/,
  );
});

test('syncs actual consumer files together only after npm publication', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cli-consumer-pins-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const originals = await Promise.all(
    pinFiles.map(async (file) => {
      const source = await readFile(
        join(fileURLToPath(new URL('../../', import.meta.url)), file),
        'utf8',
      );
      const older = source.replace(
        /(MOLTNET_CLI_VERSION(?: = |: ))'[^']+'/,
        "$1'3.1.0'",
      );
      assert.notEqual(older, source, `fixture must change ${file}`);
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), older);
      return older;
    }),
  );
  const readConsumers = () =>
    Promise.all(pinFiles.map((file) => readFile(join(root, file), 'utf8')));
  const visited = [];
  let partial = true;
  const get = async (url) => {
    visited.push(url);
    const missing = partial && url.includes('arm64');
    return {
      ok: !missing,
      status: missing ? 404 : 200,
      json: async () => ({ version: '3.19.0' }),
    };
  };

  await main({ root, get, version: null });
  assert.deepEqual(await readConsumers(), originals);

  partial = false;
  visited.length = 0;
  await main({ root, get, version: null });
  const updated = await readConsumers();
  assert.deepEqual(
    updated,
    originals.map((source) => source.replace('3.1.0', '3.19.0')),
  );
  assert.equal(visited.length, 4);

  visited.length = 0;
  await main({ root, get, version: null });
  assert.deepEqual(await readConsumers(), updated);
  assert.equal(visited.length, 1);

  await writeFile(join(root, pinFiles[1]), 'env: {}');
  await assert.rejects(main({ root, get, version: '3.20.0' }), /pin not found/);
  assert.equal(await readFile(join(root, pinFiles[0]), 'utf8'), updated[0]);
});
