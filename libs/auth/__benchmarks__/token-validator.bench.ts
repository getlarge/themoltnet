import crypto from 'node:crypto';
import http from 'node:http';
import { performance } from 'node:perf_hooks';

import {
  createTokenValidator,
  type TokenValidator,
} from '../src/token-validator.js';

const CLIENT_ID = 'benchmark-client';
const IDENTITY_ID = '550e8400-e29b-41d4-a716-446655440000';
const ITERATIONS = 10_000;
const KEY_ID = 'benchmark-rs256-key';
const WARMUP_ITERATIONS = 500;

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const publicJwk = {
  ...publicKey.export({ format: 'jwk' }),
  alg: 'RS256',
  kid: KEY_ID,
  use: 'sig',
};

function createToken(issuer: string): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = {
    alg: 'RS256',
    kid: KEY_ID,
    typ: 'JWT',
  };
  const payload = {
    client_id: CLIENT_ID,
    exp: now + 3_600,
    iat: now,
    iss: issuer,
    'moltnet:fingerprint': 'A1B2-C3D4-E5F6-07A8',
    'moltnet:identity_id': IDENTITY_ID,
    'moltnet:public_key': 'ed25519:AAAA+/bbbb==',
    scope: 'diary:read diary:write',
    sub: CLIENT_ID,
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    'base64url',
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  const signature = crypto.sign(
    'sha256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    privateKey,
  );
  return `${encodedHeader}.${encodedPayload}.${signature.toString('base64url')}`;
}

async function verifyRepeatedly(
  validator: TokenValidator,
  token: string,
  iterations: number,
): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    const context = await validator.resolveAuthContext(token);
    if (!context) {
      throw new Error('Benchmark token failed verification');
    }
  }
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function main(): Promise<void> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Benchmark JWKS server did not bind to a TCP port');
    }
    const issuer = `http://127.0.0.1:${address.port}`;
    const token = createToken(issuer);
    const validator = createTokenValidator(
      {
        getOAuth2Client: async () => {
          throw new Error('Client metadata fallback should not run');
        },
        introspectOAuth2Token: async () => ({ active: false }),
      } as never,
      {
        allowedIssuers: [issuer],
        jwksUri: `${issuer}/.well-known/jwks.json`,
      },
    );

    await verifyRepeatedly(validator, token, WARMUP_ITERATIONS);
    const startedAt = performance.now();
    await verifyRepeatedly(validator, token, ITERATIONS);
    const durationMs = performance.now() - startedAt;

    process.stdout.write(
      `${JSON.stringify({
        durationMs,
        implementation: process.env['JWT_BENCHMARK_LABEL'] ?? 'current',
        iterations: ITERATIONS,
        operationsPerSecond: (ITERATIONS / durationMs) * 1_000,
      })}\n`,
    );
  } finally {
    await closeServer(server);
  }
}

await main();
