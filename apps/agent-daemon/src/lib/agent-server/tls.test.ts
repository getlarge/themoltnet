import { X509Certificate } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureLocalTlsMaterial } from './tls.js';

const roots: string[] = [];

afterEach(async () => {
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
  });
});
