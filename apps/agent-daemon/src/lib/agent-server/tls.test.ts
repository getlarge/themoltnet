import { X509Certificate } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ensureLocalTlsMaterial, removeLocalCa, trustLocalCa } from './tls.js';

const { security } = vi.hoisted(() => ({
  security: vi.fn(async (_program: string, _args: string[]) => ({
    stdout: '',
    stderr: '',
  })),
}));

// Never alter the test runner's keychain, including on macOS CI.
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: security,
  }),
}));

const roots: string[] = [];

afterEach(async () => {
  security.mockReset();
  security.mockResolvedValue({ stdout: '', stderr: '' });
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe('ensureLocalTlsMaterial', () => {
  it('creates and reuses a CA-signed certificate for the loopback IP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moltnet-tls-'));
    roots.push(root);

    const first = await ensureLocalTlsMaterial(root);
    const second = await ensureLocalTlsMaterial(root);
    const ca = new X509Certificate(first.ca);
    const leaf = new X509Certificate(first.cert);

    expect(leaf.checkIssued(ca)).toBe(true);
    expect(leaf.checkIP('127.0.0.1')).toBe('127.0.0.1');
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.cert).toBe(first.cert);
    await expect(
      access(join(root, 'tls', 'local-ca-key.pem')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(leaf.ca).toBe(false);
    expect(leaf.verify(ca.publicKey)).toBe(true);
    expect(ca.verify(leaf.publicKey)).toBe(false);
  });
});

it('rotates previous signing material instead of reusing it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moltnet-tls-'));
  roots.push(root);
  const previous = await ensureLocalTlsMaterial(root);
  // Presence is sufficient to require rotation, even when the old key is invalid.
  await writeFile(
    join(root, 'tls', 'local-ca-key.pem'),
    'previous signing material',
    { mode: 0o600 },
  );
  const replacement = await ensureLocalTlsMaterial(root);
  expect(replacement.fingerprint).not.toBe(previous.fingerprint);
  await expect(
    access(join(root, 'tls', 'local-ca-key.pem')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

it('replaces an inconsistent certificate and key generation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moltnet-tls-'));
  const other = await mkdtemp(join(tmpdir(), 'moltnet-tls-'));
  roots.push(root, other);
  const previous = await ensureLocalTlsMaterial(root);
  await ensureLocalTlsMaterial(other);
  await writeFile(
    join(root, 'tls', 'loopback-key.pem'),
    await readFile(join(other, 'tls', 'loopback-key.pem')),
  );
  const replacement = await ensureLocalTlsMaterial(root);
  expect(replacement.fingerprint).not.toBe(previous.fingerprint);
});

it('limits new macOS trust to loopback TLS and removes both prior trust domains', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moltnet-tls-'));
  roots.push(root);
  await ensureLocalTlsMaterial(root);
  security.mockClear();
  await trustLocalCa(root);
  expect(security).toHaveBeenCalledWith('/usr/bin/security', [
    'add-trusted-cert',
    '-r',
    'trustRoot',
    '-p',
    'ssl',
    '-s',
    '127.0.0.1',
    '-k',
    expect.any(String),
    join(root, 'tls', 'local-ca.pem'),
  ]);
  security.mockClear();
  await removeLocalCa(root);
  expect(security.mock.calls.map((call) => call[1][0])).toEqual([
    'remove-trusted-cert',
    'remove-trusted-cert',
    'delete-certificate',
  ]);
});

it('stops removal when the platform refuses to remove trust', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moltnet-tls-'));
  roots.push(root);
  await ensureLocalTlsMaterial(root);
  security.mockClear();
  security.mockRejectedValueOnce(new Error('permission denied'));
  await expect(removeLocalCa(root)).rejects.toThrow('permission denied');
  expect(security).toHaveBeenCalledTimes(1);
  await expect(
    access(join(root, 'tls', 'local-ca.pem')),
  ).resolves.toBeUndefined();
});
