import { cryptoService } from '@moltnet/crypto-service';
import { describe, expect, it, vi } from 'vitest';

import { createExecutorAttestor } from '../src/executor-attestation.js';

const readConfigMock = vi.hoisted(() => vi.fn());

vi.mock('../src/credentials.js', () => ({
  readConfig: readConfigMock,
}));

describe('createExecutorAttestor', () => {
  it('clones and deterministically signs one executor manifest', async () => {
    const keys = await cryptoService.generateKeyPair();
    const manifest = {
      schemaVersion: 'moltnet:executor-manifest:v1',
      runtime: { id: 'custom', version: '1' },
    };
    const attestor = createExecutorAttestor({
      manifest,
      signingPrivateKey: keys.privateKey,
    });
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
    expect(readConfigMock).not.toHaveBeenCalled();
  });

  it.each(['', 'not-base64', Buffer.alloc(31).toString('base64')])(
    'rejects malformed signing material before returning an attestor',
    (signingPrivateKey) => {
      expect(() =>
        createExecutorAttestor({ manifest: {}, signingPrivateKey }),
      ).toThrow('base64-encoded 32-byte Ed25519 private key');
    },
  );

  it('produces deterministic registration, claim, and completion signatures', async () => {
    const keys = await cryptoService.generateKeyPair();
    const input = {
      manifest: { schemaVersion: 'moltnet:executor-manifest:v1' },
      signingPrivateKey: keys.privateKey,
    };
    const first = createExecutorAttestor(input);
    const second = createExecutorAttestor(input);

    await expect(first.registration()).resolves.toEqual(
      await second.registration(),
    );
    await expect(first.claim('task-1')).resolves.toEqual(
      await second.claim('task-1'),
    );
    await expect(
      first.complete({ taskId: 'task-1', attemptN: 2, outputCid: 'cid-1' }),
    ).resolves.toEqual(
      await second.complete({
        taskId: 'task-1',
        attemptN: 2,
        outputCid: 'cid-1',
      }),
    );
  });

  it('normalizes unpadded base64url signing material before use', async () => {
    const keys = await cryptoService.generateKeyPair();
    const base64url = keys.privateKey
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    const manifest = { schemaVersion: 'moltnet:executor-manifest:v1' };

    const canonical = createExecutorAttestor({
      manifest,
      signingPrivateKey: keys.privateKey,
    });
    const normalized = createExecutorAttestor({
      manifest,
      signingPrivateKey: `  ${base64url}  `,
    });

    await expect(normalized.registration()).resolves.toEqual(
      await canonical.registration(),
    );
    await expect(normalized.claim('task-1')).resolves.toEqual(
      await canonical.claim('task-1'),
    );
  });
});
