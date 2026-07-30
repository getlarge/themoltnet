import { generateKeyPairSync, randomUUID } from 'node:crypto';

import {
  CREDENTIAL_CLAIM_NAMESPACE,
  CREDENTIAL_JWT_ALGORITHM,
  CredentialError,
  isConnectorCredentialClaims,
  isTaskCredentialClaims,
} from '@themoltnet/credentials';
import { importJWK, type JWK, SignJWT } from 'jose';

import type {
  BrokerClock,
  DerivedToken,
  DeriveTokenInput,
  TokenDeriver,
} from './broker.js';

/**
 * MoltNet-held signer for the credential ladder.
 *
 * MoltNet is the only shipped verifier of ladder credentials, so the signing
 * authority lives here rather than in an external derivation service: it keeps
 * the task-claim critical path free of a third-party availability dependency
 * and lets MoltNet own every reserved claim (`iss`, `aud`, `sub`, `exp`, `jti`).
 *
 * The parent credential is deliberately unused. Route authentication verifies
 * (and therefore revalidates the revocation state of) the caller's agent key on
 * every request before the broker runs, so re-presenting it to a signer would
 * add no authority check — only a place for it to leak.
 */

/** Ed25519 JWK key type, per RFC 8037. */
const SIGNING_KEY_TYPE = 'OKP';
const SIGNING_KEY_CURVE = 'Ed25519';
/**
 * A `kid` travels into evidence rows as `credentialKid`, so keep it inside the
 * `Identifier` shape the evidence contract accepts.
 */
const SIGNING_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

const systemClock: BrokerClock = { now: () => new Date() };

/** An imported MoltNet signing key: private material plus its public JWK. */
export interface LocalSigningKey {
  kid: string;
  /** Signing key. Never serialized — only `publicJwk` is publishable. */
  privateKey: CryptoKey;
  /** Public half, as published through the MoltNet JWKS document. */
  publicJwk: JWK;
}

export interface LocalTokenDeriverOptions {
  /** `iss` minted into every credential. MoltNet issues capability. */
  issuer: string;
  /** `aud` minted into every credential — the relying-party surface(s). */
  audience: string | readonly string[];
  /** Active signing key. Retiring keys stay in the JWKS but never sign. */
  signingKey: LocalSigningKey;
  clock?: BrokerClock;
  generateJti?: () => string;
}

function signingKeyError(detail: string): Error {
  // Never echo the supplied value: it is private key material.
  return new Error(
    `Credential signing key is invalid: ${detail}. Expected an Ed25519 private JWK (kty=${SIGNING_KEY_TYPE}, crv=${SIGNING_KEY_CURVE}) with "d" and "kid".`,
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseSigningKeyJwk(source: unknown): JWK & { kid: string } {
  let candidate: unknown = source;
  if (typeof source === 'string') {
    try {
      candidate = JSON.parse(source);
    } catch {
      throw signingKeyError('not valid JSON');
    }
  }
  if (typeof candidate !== 'object' || candidate === null) {
    throw signingKeyError('not a JSON object');
  }
  const jwk = candidate as JWK;
  if (jwk.kty !== SIGNING_KEY_TYPE) throw signingKeyError('unsupported "kty"');
  if (jwk.crv !== SIGNING_KEY_CURVE) throw signingKeyError('unsupported "crv"');
  if (!nonEmptyString(jwk.x)) throw signingKeyError('missing "x"');
  if (!nonEmptyString(jwk.d)) throw signingKeyError('missing "d"');
  if (!nonEmptyString(jwk.kid)) throw signingKeyError('missing "kid"');
  if (!SIGNING_KEY_ID_PATTERN.test(jwk.kid)) {
    throw signingKeyError('unsupported "kid" shape');
  }
  return jwk as JWK & { kid: string };
}

/**
 * Generate a fresh Ed25519 signing key as a private JWK.
 *
 * Emit one per environment and store it as a secret; the returned object is
 * the exact value {@link importLocalSigningKey} accepts.
 */
export function generateLocalSigningKeyJwk(kid: string = randomUUID()): JWK {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' }) as JWK;
  return {
    ...jwk,
    kid,
    alg: CREDENTIAL_JWT_ALGORITHM,
    use: 'sig',
  };
}

/**
 * Validate and import a signing key at startup, so misconfigured key material
 * fails the boot rather than the first issuance.
 */
export async function importLocalSigningKey(
  source: unknown,
): Promise<LocalSigningKey> {
  const jwk = parseSigningKeyJwk(source);
  let privateKey: Awaited<ReturnType<typeof importJWK>>;
  try {
    privateKey = await importJWK(jwk, CREDENTIAL_JWT_ALGORITHM);
  } catch {
    throw signingKeyError('not importable as an EdDSA key');
  }
  if (privateKey instanceof Uint8Array) {
    throw signingKeyError('resolved to symmetric key material');
  }
  return {
    kid: jwk.kid,
    privateKey,
    publicJwk: {
      kty: SIGNING_KEY_TYPE,
      crv: SIGNING_KEY_CURVE,
      x: jwk.x,
      kid: jwk.kid,
      alg: CREDENTIAL_JWT_ALGORITHM,
      use: 'sig',
    },
  };
}

/** Public JWKS document served to relying parties. */
export interface CredentialSigningJwks {
  keys: JWK[];
}

/**
 * Build the JWKS document relying parties fetch.
 *
 * Pass the active key plus any key still inside the maximum credential
 * lifetime so a rotation never invalidates a live credential: publish both,
 * sign with the newer, drop the elder once no credential it signed can remain
 * valid.
 */
export function credentialSigningJwks(
  keys: readonly LocalSigningKey[],
): CredentialSigningJwks {
  const published: JWK[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key.kid)) continue;
    seen.add(key.kid);
    // Defense in depth: a private member here would publish the signing key.
    const { d: _d, ...publicMembers } = key.publicJwk;
    published.push(publicMembers);
  }
  return { keys: published };
}

function normalizeAudience(
  audience: string | readonly string[],
): string | string[] {
  const values = (typeof audience === 'string' ? [audience] : [...audience])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) {
    throw new Error('Credential audience must contain at least one value');
  }
  const [single] = values;
  return values.length === 1 && single !== undefined ? single : values;
}

/**
 * Resolve `sub` from the broker's canonical claims. Doubling as a shape check
 * means the signer refuses anything the broker did not canonicalize.
 */
function credentialSubject(claims: unknown): string {
  if (isTaskCredentialClaims(claims)) return claims.agentId;
  if (isConnectorCredentialClaims(claims)) return claims.task.agentId;
  throw new CredentialError(
    'derivation_failed',
    'Credential derivation received non-canonical claims',
  );
}

export function createLocalTokenDeriver(
  options: LocalTokenDeriverOptions,
): TokenDeriver {
  const issuer = options.issuer.trim();
  if (issuer.length === 0) {
    throw new Error('Credential issuer must not be empty');
  }
  const audience = normalizeAudience(options.audience);
  const clock = options.clock ?? systemClock;
  const generateJti = options.generateJti ?? (() => randomUUID());
  const { kid, privateKey } = options.signingKey;

  return {
    async derive(input: DeriveTokenInput): Promise<DerivedToken> {
      const claims = input.customClaims[CREDENTIAL_CLAIM_NAMESPACE];
      const subject = credentialSubject(claims);
      if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
        throw new CredentialError(
          'derivation_failed',
          'Credential derivation received an invalid lifetime',
        );
      }
      // Floor the issue time so `exp` never rounds past the authority window
      // the broker computed from the lease.
      const issuedAt = Math.floor(clock.now().getTime() / 1_000);
      if (!Number.isSafeInteger(issuedAt)) {
        throw new CredentialError(
          'derivation_failed',
          'Credential derivation received an invalid clock reading',
        );
      }
      const expiresAt = issuedAt + input.ttlSeconds;
      const jti = generateJti();
      let token: string;
      try {
        token = await new SignJWT({
          [CREDENTIAL_CLAIM_NAMESPACE]: claims,
          ...(input.scopes.length > 0
            ? { scope: [...input.scopes].join(' ') }
            : {}),
        })
          .setProtectedHeader({
            alg: CREDENTIAL_JWT_ALGORITHM,
            kid,
            typ: 'JWT',
          })
          .setIssuer(issuer)
          .setSubject(subject)
          .setAudience(audience)
          .setJti(jti)
          .setIssuedAt(issuedAt)
          .setNotBefore(issuedAt)
          .setExpirationTime(expiresAt)
          .sign(privateKey);
      } catch {
        // Stay symmetric with every other deriver: no cause, no upstream
        // message, nothing that could carry key or credential material.
        throw new CredentialError(
          'derivation_failed',
          'Credential derivation failed',
        );
      }
      return { token, expiresAt: new Date(expiresAt * 1_000), jti, kid };
    },
  };
}
