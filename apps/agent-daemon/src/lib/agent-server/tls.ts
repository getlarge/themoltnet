import 'reflect-metadata';

import { execFile } from 'node:child_process';
import {
  createPrivateKey,
  createPublicKey,
  webcrypto,
  X509Certificate,
} from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  BasicConstraintsExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  IP,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from '@peculiar/x509';

const execFileAsync = promisify(execFile);
const CA_COMMON_NAME = 'MoltNet Local Agent CA';
const LEAF_COMMON_NAME = 'MoltNet Local Agent';
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;

function loginKeychainPath(): string {
  return join(homedir(), 'Library', 'Keychains', 'login.keychain-db');
}

export interface LocalTlsMaterial {
  key: string;
  cert: string;
  ca: string;
  fingerprint: string;
}

function pemPrivateKey(key: CryptoKey): Promise<string> {
  return webcrypto.subtle.exportKey('pkcs8', key).then((der) =>
    createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'pkcs8' })
      .export({ format: 'pem', type: 'pkcs8' })
      .toString(),
  );
}

async function localTlsMaterialFromDirectory(
  dir: string,
): Promise<LocalTlsMaterial | null> {
  try {
    const [key, cert, ca] = await Promise.all([
      readFile(join(dir, 'loopback-key.pem'), 'utf8'),
      readFile(join(dir, 'loopback-cert.pem'), 'utf8'),
      readFile(join(dir, 'local-ca.pem'), 'utf8'),
    ]);
    const parsed = new X509Certificate(cert);
    const authority = new X509Certificate(ca);
    if (
      Date.parse(parsed.validTo) - Date.now() > RENEW_BEFORE_MS &&
      Date.parse(authority.validTo) - Date.now() > RENEW_BEFORE_MS &&
      authority.keyUsage?.includes('1.3.6.1.5.5.7.3.1') &&
      parsed.checkIP('127.0.0.1') === '127.0.0.1' &&
      parsed.verify(authority.publicKey) &&
      parsed.publicKey.equals(createPublicKey(key))
    ) {
      return {
        key,
        cert,
        ca,
        fingerprint: new X509Certificate(ca).fingerprint256,
      };
    }
  } catch {
    // Missing or inconsistent material requires a new generation below.
  }
  return null;
}

/** Creates a per-user CA and loopback-only leaf certificate under a 0700 directory. */
export async function ensureLocalTlsMaterial(
  root: string,
): Promise<LocalTlsMaterial> {
  const dir = join(root, 'tls');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Retire the previous trust before replacing its certificate. In particular,
  // a restart during migration must never lose the certificate needed to revoke
  // that trust. Native administration surfaces any platform failure to the user.
  const previousSigningKey = join(dir, 'local-ca-key.pem');
  const hasPreviousSigningKey = await stat(previousSigningKey).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
  const existing = await localTlsMaterialFromDirectory(dir);
  if (existing && !hasPreviousSigningKey) return existing;
  if (isMacos() && (await isLocalCaTrusted(root))) await removeLocalCa(root);

  // The signing key exists only for this generation. Renewal creates a new
  // root and requires local approval again; no reusable CA key is stored.
  const caKeys = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const caCert = await X509CertificateGenerator.createSelfSigned({
    name: `CN=${CA_COMMON_NAME}`,
    keys: caKeys,
    notAfter: new Date(Date.now() + 366 * 24 * 60 * 60 * 1000),
    extensions: [
      new BasicConstraintsExtension(true, 0, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign, true),
      new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth], true),
    ],
  });
  const ca = caCert.toString('pem');
  const leafKeys = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const leafCert = await X509CertificateGenerator.create({
    subject: `CN=${LEAF_COMMON_NAME}`,
    issuer: `CN=${CA_COMMON_NAME}`,
    publicKey: leafKeys.publicKey,
    signingKey: caKeys.privateKey,
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    extensions: [
      new BasicConstraintsExtension(false, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
      new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth]),
      new SubjectAlternativeNameExtension(
        [{ type: IP, value: '127.0.0.1' }],
        true,
      ),
    ],
  });
  const key = await pemPrivateKey(leafKeys.privateKey);
  const cert = leafCert.toString('pem');
  const writes: Promise<void>[] = [
    writeFile(join(dir, 'loopback-key.pem'), key, { mode: 0o600 }),
    writeFile(join(dir, 'loopback-cert.pem'), cert, { mode: 0o600 }),
  ];
  writes.push(writeFile(join(dir, 'local-ca.pem'), ca, { mode: 0o600 }));
  await Promise.all(writes);
  await rm(previousSigningKey, { force: true });
  return { key, cert, ca, fingerprint: new X509Certificate(ca).fingerprint256 };
}

export async function trustLocalCa(root: string): Promise<void> {
  const caPath = join(root, 'tls', 'local-ca.pem');
  await execFileAsync('/usr/bin/security', [
    'add-trusted-cert',
    '-r',
    'trustRoot',
    '-p',
    'ssl',
    '-s',
    '127.0.0.1',
    '-k',
    loginKeychainPath(),
    caPath,
  ]);
}

export async function isLocalCaTrusted(root: string): Promise<boolean> {
  try {
    const ca = await readFile(join(root, 'tls', 'local-ca.pem'), 'utf8');
    const { stdout } = await execFileAsync('/usr/bin/security', [
      'find-certificate',
      '-a',
      '-p',
      '-c',
      CA_COMMON_NAME,
      loginKeychainPath(),
    ]);
    return stdout.includes(ca.trim());
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return false;
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? error.stderr
        : undefined;
    if (
      typeof stderr === 'string' &&
      stderr.trim() ===
        'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.'
    )
      return false;
    throw error;
  }
}

export async function removeLocalCa(root: string): Promise<void> {
  const ca = await readFile(join(root, 'tls', 'local-ca.pem'), 'utf8');
  const fingerprint = new X509Certificate(ca).fingerprint256.replaceAll(
    ':',
    '',
  );
  // Earlier releases used admin trust; current installs use user trust.
  // Remove both entries before deleting the certificate from the keychain.
  const caPath = join(root, 'tls', 'local-ca.pem');
  await removeTrustSettings(['remove-trusted-cert', '-d', caPath]);
  await removeTrustSettings(['remove-trusted-cert', caPath]);
  await execFileAsync('/usr/bin/security', [
    'delete-certificate',
    '-Z',
    fingerprint,
    loginKeychainPath(),
  ]);
}

export function isMacos(): boolean {
  return process.platform === 'darwin';
}

async function removeTrustSettings(args: string[]): Promise<void> {
  try {
    await execFileAsync('/usr/bin/security', args, {
      env: { LC_ALL: 'C' },
    });
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? error.stderr
        : undefined;
    if (
      typeof stderr === 'string' &&
      [
        'SecTrustSettingsRemoveTrustSettings: No Trust Settings were found.',
        'SecTrustSettingsRemoveTrustSettings: The specified item could not be found in the keychain.',
      ].includes(stderr.trim())
    )
      return;
    throw error;
  }
}
