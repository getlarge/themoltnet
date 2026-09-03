import 'reflect-metadata';

import { execFile } from 'node:child_process';
import {
  createPrivateKey,
  createPublicKey,
  webcrypto,
  X509Certificate,
} from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

async function importCaKeyPair(pem: string): Promise<CryptoKeyPair> {
  const privateKey = createPrivateKey(pem);
  const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const publicDer = createPublicKey(privateKey).export({
    format: 'der',
    type: 'spki',
  });
  const [privateCryptoKey, publicCryptoKey] = await Promise.all([
    webcrypto.subtle.importKey(
      'pkcs8',
      privateDer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    ),
    webcrypto.subtle.importKey(
      'spki',
      publicDer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    ),
  ]);
  return { privateKey: privateCryptoKey, publicKey: publicCryptoKey };
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
    if (Date.parse(parsed.validTo) - Date.now() > RENEW_BEFORE_MS) {
      return {
        key,
        cert,
        ca,
        fingerprint: new X509Certificate(ca).fingerprint256,
      };
    }
  } catch {
    // Missing or malformed material is replaced atomically below.
  }
  return null;
}

/** Creates a per-user CA and loopback-only leaf certificate under a 0700 directory. */
export async function ensureLocalTlsMaterial(
  root: string,
): Promise<LocalTlsMaterial> {
  const dir = join(root, 'tls');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const existing = await localTlsMaterialFromDirectory(dir);
  if (existing) return existing;

  let ca: string;
  let caKeys: CryptoKeyPair;
  let caKey: string | undefined;
  try {
    ca = await readFile(join(dir, 'local-ca.pem'), 'utf8');
    caKeys = await importCaKeyPair(
      await readFile(join(dir, 'local-ca-key.pem'), 'utf8'),
    );
  } catch {
    caKeys = (await webcrypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const caCert = await X509CertificateGenerator.createSelfSigned({
      name: `CN=${CA_COMMON_NAME}`,
      keys: caKeys,
      notAfter: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000),
      extensions: [
        new BasicConstraintsExtension(true, undefined, true),
        new KeyUsagesExtension(
          KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign,
          true,
        ),
      ],
    });
    ca = caCert.toString('pem');
    caKey = await pemPrivateKey(caKeys.privateKey);
  }
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
  if (caKey) {
    writes.push(
      writeFile(join(dir, 'local-ca.pem'), ca, { mode: 0o600 }),
      writeFile(join(dir, 'local-ca-key.pem'), caKey, { mode: 0o600 }),
    );
  }
  await Promise.all(writes);
  return { key, cert, ca, fingerprint: new X509Certificate(ca).fingerprint256 };
}

export async function trustLocalCa(root: string): Promise<void> {
  const caPath = join(root, 'tls', 'local-ca.pem');
  await execFileAsync('security', [
    'add-trusted-cert',
    '-d',
    '-r',
    'trustRoot',
    '-k',
    loginKeychainPath(),
    caPath,
  ]);
}

export async function isLocalCaTrusted(root: string): Promise<boolean> {
  const ca = await readFile(join(root, 'tls', 'local-ca.pem'), 'utf8');
  try {
    const { stdout } = await execFileAsync('security', [
      'find-certificate',
      '-a',
      '-p',
      '-c',
      CA_COMMON_NAME,
      loginKeychainPath(),
    ]);
    return stdout.includes(ca.trim());
  } catch {
    return false;
  }
}

export async function removeLocalCa(root: string): Promise<void> {
  const ca = await readFile(join(root, 'tls', 'local-ca.pem'), 'utf8');
  const fingerprint = new X509Certificate(ca).fingerprint256.replaceAll(
    ':',
    '',
  );
  await execFileAsync('security', [
    'delete-certificate',
    '-Z',
    fingerprint,
    loginKeychainPath(),
  ]);
}

export function isMacos(): boolean {
  return process.platform === 'darwin';
}
