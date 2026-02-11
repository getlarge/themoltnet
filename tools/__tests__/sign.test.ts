import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { cryptoService } from '@moltnet/crypto-service';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const SIGN_SCRIPT = resolve(__dirname, '../sign.mjs');

async function runSign(
  payload: string | undefined,
  env: Record<string, string>,
  mode: 'arg' | 'stdin' = 'arg',
): Promise<{ stdout: string; stderr: string }> {
  const args =
    mode === 'arg' && payload ? [SIGN_SCRIPT, payload] : [SIGN_SCRIPT];
  const options = {
    env: { ...process.env, ...env },
    ...(mode === 'stdin' ? {} : {}),
  };

  if (mode === 'stdin' && payload) {
    return new Promise((resolve, reject) => {
      const child = execFile('node', args, options, (err, stdout, stderr) => {
        if (err) {
          reject(Object.assign(err, { stdout, stderr }));
        } else {
          resolve({ stdout, stderr });
        }
      });
      child.stdin!.write(payload);
      child.stdin!.end();
    });
  }

  return execFileAsync('node', args, options);
}

describe('sign.mjs', () => {
  it('signs a payload via argument and produces a valid signature', async () => {
    // Arrange
    const keyPair = await cryptoService.generateKeyPair();
    const message = 'hello.nonce123';

    // Act
    const { stdout } = await runSign(message, {
      MOLTNET_PRIVATE_KEY: keyPair.privateKey,
    });

    // Assert
    const valid = await cryptoService.verify(
      message,
      stdout,
      keyPair.publicKey,
    );
    expect(valid).toBe(true);
  });

  it('signs a payload via stdin and produces a valid signature', async () => {
    // Arrange
    const keyPair = await cryptoService.generateKeyPair();
    const message = 'test-payload.abc456';

    // Act
    const { stdout } = await runSign(
      message,
      { MOLTNET_PRIVATE_KEY: keyPair.privateKey },
      'stdin',
    );

    // Assert
    const valid = await cryptoService.verify(
      message,
      stdout,
      keyPair.publicKey,
    );
    expect(valid).toBe(true);
  });

  it('produces identical signatures for the same key and payload', async () => {
    // Arrange
    const keyPair = await cryptoService.generateKeyPair();
    const message = 'deterministic-test';
    const env = { MOLTNET_PRIVATE_KEY: keyPair.privateKey };

    // Act
    const { stdout: sig1 } = await runSign(message, env);
    const { stdout: sig2 } = await runSign(message, env);

    // Assert — Ed25519 is deterministic
    expect(sig1).toBe(sig2);
  });

  it('exits with error when MOLTNET_PRIVATE_KEY is missing', async () => {
    // Arrange & Act & Assert
    await expect(
      runSign('payload', { MOLTNET_PRIVATE_KEY: '' }),
    ).rejects.toThrow();
  });

  it('exits with error when private key is wrong length', async () => {
    // Arrange & Act & Assert
    await expect(
      runSign('payload', {
        MOLTNET_PRIVATE_KEY: Buffer.from('too-short').toString('base64'),
      }),
    ).rejects.toThrow();
  });
});
