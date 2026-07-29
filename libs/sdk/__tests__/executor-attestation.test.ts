import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cryptoService } from '@moltnet/crypto-service';
import { afterEach, describe, expect, it } from 'vitest';

import { writeConfig } from '../src/credentials.js';
import { createExecutorAttestor } from '../src/executor-attestation.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('createExecutorAttestor', () => {
  it('clones and deterministically signs one executor manifest', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'moltnet-attestor-'));
    temporaryDirectories.push(configDir);
    const keys = await cryptoService.generateKeyPair();
    await writeConfig(
      {
        identity_id: '11111111-1111-4111-8111-111111111111',
        registered_at: '2026-07-28T00:00:00.000Z',
        oauth2: { client_id: 'test', client_secret: 'test' },
        keys: {
          public_key: keys.publicKey,
          private_key: keys.privateKey,
          fingerprint: keys.fingerprint,
        },
        endpoints: {
          api: 'https://api.example.test',
          mcp: 'https://mcp.example.test',
        },
      },
      configDir,
    );
    const manifest = {
      schemaVersion: 'moltnet:executor-manifest:v1',
      runtime: { id: 'custom', version: '1' },
    };
    const attestor = await createExecutorAttestor({ manifest, configDir });
    manifest.runtime.version = 'mutated';

    const registration = await attestor.registration();
    const repeatedRegistration = await attestor.registration();
    const first = await attestor.claim('task-1');
    const second = await attestor.claim('task-1');

    expect(repeatedRegistration).toBe(registration);
    expect(registration.executorFingerprint).toBe(attestor.fingerprint);
    expect(registration.executorManifest).toEqual({
      schemaVersion: 'moltnet:executor-manifest:v1',
      runtime: { id: 'custom', version: '1' },
    });
    expect(attestor.reference()).toEqual({
      executorFingerprint: attestor.fingerprint,
    });
    expect(first).toEqual(second);
    expect(first.executorManifest).toEqual({
      schemaVersion: 'moltnet:executor-manifest:v1',
      runtime: { id: 'custom', version: '1' },
    });
    expect(first.executorFingerprint).toBe(attestor.fingerprint);
  });
});
