import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const verifier = join(here, 'verify-apple-p12.sh');
const fixture = mkdtempSync(join(tmpdir(), 'moltnet-p12-chain-test-'));
const password = 'test-password';
const pkcs12LegacySupported = (() => {
  const result = spawnSync('openssl', ['pkcs12', '-help'], {
    encoding: 'utf8',
  });
  return `${result.stdout}${result.stderr}`.includes('-legacy');
})();

function openssl(args) {
  execFileSync('openssl', args, { cwd: fixture, stdio: 'ignore' });
}

function exportPkcs12(args) {
  openssl([
    'pkcs12',
    '-export',
    ...(pkcs12LegacySupported ? ['-legacy'] : []),
    ...args,
  ]);
}

function verify(p12, suppliedPassword = password) {
  return spawnSync('sh', [verifier, '--p12', join(fixture, p12)], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...process.env, APPLE_CERT_PASSWORD: suppliedPassword },
  });
}

before(() => {
  writeFileSync(
    join(fixture, 'intermediate.ext'),
    'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n',
  );
  writeFileSync(
    join(fixture, 'leaf.ext'),
    'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=codeSigning\n',
  );

  openssl([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '2',
    '-subj',
    '/CN=Apple Root CA/O=Apple Inc./C=US',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-keyout',
    'root.key',
    '-out',
    'root.pem',
  ]);
  openssl([
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=Developer ID Certification Authority/OU=G2/O=Apple Inc./C=US',
    '-keyout',
    'intermediate.key',
    '-out',
    'intermediate.csr',
  ]);
  openssl([
    'x509',
    '-req',
    '-days',
    '2',
    '-in',
    'intermediate.csr',
    '-CA',
    'root.pem',
    '-CAkey',
    'root.key',
    '-CAcreateserial',
    '-extfile',
    'intermediate.ext',
    '-out',
    'intermediate.pem',
  ]);
  openssl([
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=Developer ID Application: Test/OU=TESTTEAM/O=Test/C=US',
    '-keyout',
    'leaf.key',
    '-out',
    'leaf.csr',
  ]);
  openssl([
    'x509',
    '-req',
    '-days',
    '2',
    '-in',
    'leaf.csr',
    '-CA',
    'intermediate.pem',
    '-CAkey',
    'intermediate.key',
    '-CAcreateserial',
    '-extfile',
    'leaf.ext',
    '-out',
    'leaf.pem',
  ]);

  writeFileSync(
    join(fixture, 'full-chain.pem'),
    readFileSync(join(fixture, 'intermediate.pem'), 'utf8') +
      readFileSync(join(fixture, 'root.pem'), 'utf8'),
  );
  exportPkcs12([
    '-inkey',
    'leaf.key',
    '-in',
    'leaf.pem',
    '-certfile',
    'full-chain.pem',
    '-passout',
    `pass:${password}`,
    '-out',
    'full-chain.p12',
  ]);
  exportPkcs12([
    '-inkey',
    'leaf.key',
    '-in',
    'leaf.pem',
    '-certfile',
    'intermediate.pem',
    '-passout',
    `pass:${password}`,
    '-out',
    'missing-root.p12',
  ]);
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('Apple signing P12 validation', () => {
  it('accepts a leaf, intermediate, and self-signed root chain', () => {
    const result = verify('full-chain.p12');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /valid 3-certificate Developer ID chain/);
  });

  it('rejects the leaf and intermediate bundle that Quill misclassifies', () => {
    const result = verify('missing-root.p12');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /exactly 3 certificates.*found 2/);
  });

  it('does not disclose the password when decoding fails', () => {
    const result = verify('full-chain.p12', 'wrong-password');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /could not be decoded/);
    assert.doesNotMatch(result.stderr, /wrong-password/);
  });
});
