#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import process from 'node:process';
import { Readable } from 'node:stream';
import { URLSearchParams } from 'node:url';

import { createE2EAgentHarness } from '../../libs/bootstrap/src/e2e-harness.ts';
import { createS3CompatibleObjectStorage } from '../../libs/blob-storage/src/index.ts';

const [envFile, caFile] = process.argv.slice(2);
if (!envFile || !caFile) {
  throw new Error(
    'Usage: self-host-smoke.mjs <generated-env-file> <local-ca-file>',
  );
}
const localCa = readFileSync(caFile);
const settings = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

function request(host, route, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const connection = https.request(
      {
        hostname: '127.0.0.1',
        port: 443,
        servername: host,
        path: route,
        method,
        headers: { host, ...headers },
        ca: localCa,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    connection.on('error', reject);
    connection.end(body);
  });
}

async function expectStatus(host, route, status, options) {
  const response = await request(host, route, options);
  if (response.status !== status) {
    throw new Error(
      `${host}${route}: expected ${status}, got ${response.status}: ${response.body.slice(0, 300)}`,
    );
  }
  return response;
}

const api = settings.API_DOMAIN;
const oauth = settings.OAUTH_DOMAIN;
const mcp = settings.MCP_DOMAIN;
await expectStatus(api, '/health', 200);
await expectStatus(api, '/agents/whoami', 401);
await expectStatus(api, '/hooks/hydra/token-exchange', 404);
await expectStatus(settings.CONSOLE_DOMAIN, '/', 200);
const login = await expectStatus(settings.IDENTITY_DOMAIN, '/login', 303);
if (
  !login.headers.location?.startsWith(
    `https://${settings.IDENTITY_DOMAIN}/self-service/login/browser`,
  )
) {
  throw new Error('Identity login did not route through Kratos');
}

const discovery = JSON.parse(
  (await expectStatus(oauth, '/.well-known/openid-configuration', 200)).body,
);
const issuer = `https://${oauth}/`;
if (discovery.issuer !== issuer)
  throw new Error('Hydra discovery issuer mismatch');
const metadata = JSON.parse(
  (await expectStatus(mcp, '/.well-known/oauth-protected-resource', 200)).body,
);
if (!metadata.authorization_servers?.includes(issuer)) {
  throw new Error('MCP must advertise Hydra’s exact public issuer');
}

const harness = await createE2EAgentHarness({
  databaseUrl: `postgresql://moltnet:${settings.APP_DB_PASSWORD}@127.0.0.1:15432/moltnet`,
  kratosAdminUrl: 'http://127.0.0.1:14434',
  hydraPublicUrl: 'http://127.0.0.1:14444',
  hydraAdminUrl: 'http://127.0.0.1:14445',
  ketoReadUrl: 'http://127.0.0.1:14466',
  ketoWriteUrl: 'http://127.0.0.1:14467',
  log: (message) => process.stdout.write(`${message}\n`),
});
try {
  const agent = await harness.createAgent('SelfHostSmoke');
  const tokenRequest = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: agent.clientId,
    client_secret: agent.clientSecret,
    scope: 'agent:profile',
  });
  const tokenResponse = await expectStatus(api, '/oauth2/token', 200, {
    method: 'POST',
    body: tokenRequest.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const { access_token: accessToken } = JSON.parse(tokenResponse.body);
  if (!accessToken) throw new Error('Hydra did not issue an access token');
  const tokenClaims = JSON.parse(
    Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'),
  );
  if (tokenClaims.iss !== issuer) {
    throw new Error('Issued token did not use Hydra’s public issuer');
  }
  const profile = JSON.parse(
    (
      await expectStatus(api, '/agents/whoami', 200, {
        headers: { authorization: `Bearer ${accessToken}` },
      })
    ).body,
  );
  if (
    profile.subjectId !== agent.agentId ||
    profile.fingerprint !== agent.keyPair.fingerprint
  ) {
    throw new Error('Authenticated API returned the wrong agent');
  }
} finally {
  await harness.teardown();
}

for (const bucket of ['moltnet-runtime-sessions', 'moltnet-task-artifacts']) {
  const storage = createS3CompatibleObjectStorage(
    {
      accessKeyId: settings.S3_ACCESS_KEY_ID,
      secretAccessKey: settings.S3_SECRET_ACCESS_KEY,
      endpoint: 'http://127.0.0.1:18333',
      region: 'us-east-1',
      forcePathStyle: true,
      bucket,
    },
    { missingObjectError: (key) => new Error(`Missing smoke object: ${key}`) },
  );
  const key = `smoke/${randomUUID()}`;
  const expected = `self-host ${bucket}`;
  let written = false;
  try {
    await storage.putObject({
      key,
      body: Readable.from([Buffer.from(expected)]),
      contentLength: Buffer.byteLength(expected),
      contentType: 'text/plain',
    });
    written = true;
    const object = await storage.getObject(key);
    const chunks = [];
    for await (const chunk of object.body) chunks.push(Buffer.from(chunk));
    if (Buffer.concat(chunks).toString('utf8') !== expected) {
      throw new Error(`Object-store round trip failed for ${bucket}`);
    }
  } finally {
    if (written) await storage.deleteObject(key);
  }
}

process.stdout.write(
  'Self-host ingress, OAuth token, API, and object storage smoke passed\n',
);
