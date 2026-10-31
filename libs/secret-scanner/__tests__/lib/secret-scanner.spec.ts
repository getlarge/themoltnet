import { generateKeyPairSync } from 'node:crypto';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  containsSecretInStream,
  containsSecretInText,
  redactSecretsInText,
  SecretScanInputTooLargeError,
} from '../../src/lib/secret-scanner.js';

describe('containsSecretInText', () => {
  it.each([
    ['AWS access key ID', 'AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKL1234'],
    // secretlint-disable-next-line @secretlint/secretlint-rule-slack -- fake secret exercising the runtime scanner
    ['Slack token', 'xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx'],
    ['provider token', 'sk-abcdef0123456789abcdef'],
    ['GitHub token', 'ghp_abcdefghijklmnopqrstuvwxyz'],
  ])('detects %s', async (_name, content) => {
    expect(await containsSecretInText(content)).toBe(true);
  });

  it.each(['rsa', 'ec'] as const)(
    'detects a complete %s private key',
    async (kind) => {
      const privateKey =
        kind === 'rsa'
          ? generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey
          : generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
      const pem = privateKey
        .export({ type: 'pkcs8', format: 'pem' })
        .toString();
      expect(await containsSecretInText(pem)).toBe(true);
    },
  );

  it('does not honor submitted suppression comments', async () => {
    // Split so Secretlint does not read the fixture as a directive for this file.
    const content =
      '<!-- secretlint-' +
      'disable -->\n' +
      // secretlint-disable-next-line @secretlint/secretlint-rule-slack -- fake secret exercising the runtime scanner
      'xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx';
    expect(await containsSecretInText(content)).toBe(true);
  });

  it('accepts a benign AWS account number', async () => {
    expect(await containsSecretInText('account: 123456789012')).toBe(false);
  });

  it('detects a short Ed25519 PKCS8 key', async () => {
    const pem = generateKeyPairSync('ed25519')
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(await containsSecretInText(pem)).toBe(true);
    expect(await redactSecretsInText(`key: ${pem}\nafter`)).toBe(
      'key: [redacted]\n\nafter',
    );
  });

  it('redacts an Azure client secret without removing its label', async () => {
    const secret = 'abcdefghijklmnopqrstuvwxyz0123456789abcd';
    const content = `AZURE_CLIENT_SECRET=${secret} and safe text`;
    expect(await redactSecretsInText(content)).toBe(
      'AZURE_CLIENT_SECRET=[redacted] and safe text',
    );
  });

  it('accepts Azure tenant and client identifiers', async () => {
    const ids =
      'AZURE_TENANT_ID=12345678-1234-1234-1234-123456789abc\nAZURE_CLIENT_ID=abcdef12-1234-1234-1234-123456789abc';
    expect(await containsSecretInText(ids)).toBe(false);
  });

  it('redacts only HTTP authorization values', async () => {
    const content =
      'request failed: Bearer abcdefghijklmnopqrstuvwx on /health';
    expect(await redactSecretsInText(content)).toBe(
      'request failed: Bearer [redacted] on /health',
    );
  });

  it('redacts AWS access key IDs without removing surrounding text', async () => {
    expect(
      await redactSecretsInText('key AKIAABCDEFGHIJKL1234 was rejected'),
    ).toBe('key [redacted] was rejected');
  });

  it('bounds oversized redaction input', async () => {
    expect(await redactSecretsInText('x'.repeat(256 * 1024 + 1))).toBe(
      '[redacted]',
    );
  });
});

describe('containsSecretInStream', () => {
  it('detects an access key split across byte chunks', async () => {
    const source = Readable.from([
      Buffer.from('AWS_ACCESS_KEY_ID=AKIAABCDE'),
      Buffer.from('FGHIJKL1234'),
    ]);
    expect(await containsSecretInStream(source, 1024)).toBe(true);
  });

  it('detects a PEM block crossing scan windows', async () => {
    const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const source = Readable.from([
      Buffer.from('a'.repeat(256 * 1024 - 40)),
      Buffer.from(pem),
    ]);
    expect(await containsSecretInStream(source, 300 * 1024)).toBe(true);
  });

  it('keeps a complete line when rule context spans beyond the overlap', async () => {
    const secret = 'abcdefghijklmnopqrstuvwxyz0123456789abcd';
    const line =
      'a'.repeat(160 * 1024) +
      '\n' +
      'b'.repeat(20 * 1024) +
      'AZURE_CLIENT_SECRET=' +
      ' '.repeat(80 * 1024) +
      secret +
      '\n';
    expect(
      await containsSecretInStream(Readable.from([line]), 300 * 1024),
    ).toBe(true);
  });

  it('accepts ordinary text split across chunks', async () => {
    const source = Readable.from([
      Buffer.from('molt-api deployed in '),
      Buffer.from('eu-west-1'),
    ]);
    expect(await containsSecretInStream(source, 1024)).toBe(false);
  });

  it('rejects a stream larger than its byte limit', async () => {
    const source = Readable.from([Buffer.alloc(1025, 'a')]);
    await expect(containsSecretInStream(source, 1024)).rejects.toBeInstanceOf(
      SecretScanInputTooLargeError,
    );
  });
});
