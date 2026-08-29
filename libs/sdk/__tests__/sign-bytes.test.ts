import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSigningBytes, cryptoService } from '@moltnet/crypto-service';
import { describe, expect, it } from 'vitest';

import {
  READ_ONLY_CAPABILITIES,
  SecretProviderRegistry,
} from '../src/secrets.js';
import { signBytes } from '../src/sign.js';

describe('signBytes', () => {
  it('signs base64-encoded signing_input and produces a verifiable signature', async () => {
    const kp = await cryptoService.generateKeyPair();
    const message = 'test message for signBytes';
    const nonce = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const signingInput = Buffer.from(
      buildSigningBytes(message, nonce),
    ).toString('base64');

    const dir = await mkdtemp(join(tmpdir(), 'moltnet-sdk-test-'));
    const credPath = join(dir, 'moltnet.json');
    await writeFile(
      credPath,
      JSON.stringify({
        identity_id: 'test-identity-id',
        fingerprint: 'TEST-FPRN',
        keys: { public_key: kp.publicKey, private_key: kp.privateKey },
        client_id: 'test-client',
        client_secret: 'test-secret',
      }),
    );

    const signature = await signBytes(signingInput, dir);

    const valid = await cryptoService.verifyWithNonce(
      message,
      nonce,
      signature,
      kp.publicKey,
    );
    expect(valid).toBe(true);
  });

  it('produces the same signature as sign(message, nonce) for equivalent inputs', async () => {
    const kp = await cryptoService.generateKeyPair();
    const message = 'consistent signing test';
    const nonce = '12345678-1234-1234-1234-123456789abc';
    const signingInput = Buffer.from(
      buildSigningBytes(message, nonce),
    ).toString('base64');

    const dir = await mkdtemp(join(tmpdir(), 'moltnet-sdk-test-'));
    const credPath = join(dir, 'moltnet.json');
    await writeFile(
      credPath,
      JSON.stringify({
        identity_id: 'x',
        fingerprint: 'x',
        keys: { public_key: kp.publicKey, private_key: kp.privateKey },
        client_id: 'x',
        client_secret: 'x',
      }),
    );

    const { sign } = await import('../src/sign.js');
    const sig1 = await sign(message, nonce, dir);
    const sig2 = await signBytes(signingInput, dir);

    expect(sig1).toBe(sig2);
  });

  it('throws if credentials file does not exist', async () => {
    await expect(signBytes('dGVzdA==', '/nonexistent/path')).rejects.toThrow(
      'No credentials found',
    );
  });

  it('signs with a seed resolved from keys.private_key_ref', async () => {
    const kp = await cryptoService.generateKeyPair();
    const message = 'signBytes through a reference';
    const nonce = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee';
    const signingInput = Buffer.from(
      buildSigningBytes(message, nonce),
    ).toString('base64');
    const dir = await mkdtemp(join(tmpdir(), 'moltnet-sdk-test-'));
    await writeFile(
      join(dir, 'moltnet.json'),
      JSON.stringify({
        identity_id: 'test-identity-id',
        oauth2: { client_id: 'c', client_secret: 's' },
        keys: {
          public_key: kp.publicKey,
          fingerprint: 'FP',
          private_key_ref: { provider: 'memory', key: 'identity/FP/seed' },
        },
        endpoints: { api: 'https://api.themolt.net', mcp: 'm' },
      }),
    );
    const registry = new SecretProviderRegistry().register({
      name: 'memory',
      capabilities: READ_ONLY_CAPABILITIES,
      read: async () => kp.privateKey,
      probe: async () => 'present',
    });

    const signature = await signBytes(signingInput, dir, registry);

    await expect(
      cryptoService.verifyWithNonce(message, nonce, signature, kp.publicKey),
    ).resolves.toBe(true);
  });
});
