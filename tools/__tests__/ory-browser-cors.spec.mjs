import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { test } from 'vitest';

import {
  checkBrowserCors,
  checkDomainCors,
} from '../../infra/ory/browser-cors.mjs';

const origin = 'https://console.example.test';
const baseUrl = 'https://auth.example.test';
const headers = {
  'access-control-allow-origin': origin,
  'access-control-allow-credentials': 'true',
};
const preflightHeaders = {
  ...headers,
  'access-control-allow-methods': 'GET, POST',
  'access-control-allow-headers': 'Content-Type',
};

function browserFixture({
  preflight = preflightHeaders,
  session = headers,
  status = 401,
} = {}) {
  return async (url, options) => {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Origin, origin);
    if (options.method === 'OPTIONS') {
      assert.equal(new URL(url).pathname, '/self-service/login');
      assert.equal(options.headers['Access-Control-Request-Method'], 'POST');
      assert.equal(
        options.headers['Access-Control-Request-Headers'],
        'content-type',
      );
      return new Response(null, { status: 204, headers: preflight });
    }
    assert.equal(new URL(url).pathname, '/sessions/whoami');
    return new Response(null, { status, headers: session });
  };
}

test('accepts a permitted login preflight and an anonymous session response', async () => {
  await checkBrowserCors({ baseUrl, origin, fetchImpl: browserFixture() });
});

test('rejects a successful OPTIONS status with no CORS permission', async () => {
  await assert.rejects(
    checkBrowserCors({
      baseUrl,
      origin,
      fetchImpl: browserFixture({ preflight: {} }),
    }),
    /access-control-allow-origin/,
  );
});

test('rejects duplicate actual-response headers from two CORS layers', async () => {
  await assert.rejects(
    checkBrowserCors({
      baseUrl,
      origin,
      fetchImpl: browserFixture({
        session: {
          ...headers,
          'access-control-allow-origin': `${origin},${origin}`,
        },
      }),
    }),
    /access-control-allow-origin/,
  );
});

test('requires JSON POST permission, not just an allowed origin', async () => {
  for (const name of [
    'access-control-allow-methods',
    'access-control-allow-headers',
  ]) {
    await assert.rejects(
      checkBrowserCors({
        baseUrl,
        origin,
        fetchImpl: browserFixture({
          preflight: { ...preflightHeaders, [name]: 'unrelated' },
        }),
      }),
      /preflight must allow/,
    );
  }
});

test('does not accept a redirect or gateway error as a session response', async () => {
  for (const status of [307, 502]) {
    await assert.rejects(
      checkBrowserCors({
        baseUrl,
        origin,
        fetchImpl: browserFixture({ status }),
      }),
      /Browser session check returned HTTP/,
    );
  }
});

const domain = {
  hostname: 'auth.example.test',
  cors_enabled: true,
  cors_allowed_origins: [origin],
};

async function checkDomain(value, status = 200) {
  return checkDomainCors({
    projectId: 'example-project',
    apiKey: 'test',
    baseUrl,
    origins: [origin],
    fetchImpl: async () => new Response(JSON.stringify(value), { status }),
  });
}

test('accepts only the configured domain and exact origin policy', async () => {
  await checkDomain([domain]);
  await assert.rejects(checkDomain([]), /Enable domain-level CORS/);
  await assert.rejects(
    checkDomain([{ ...domain, cors_enabled: false }]),
    /Enable domain-level CORS/,
  );
  await assert.rejects(
    checkDomain([
      { ...domain, cors_allowed_origins: ['https://*.example.test'] },
    ]),
    /must match cors_public.origins/,
  );
  await assert.rejects(checkDomain({}, 403), /HTTP 403/);
});

test('Network template delegates CORS to the domain edge', () => {
  const project = JSON.parse(
    readFileSync(
      new URL('../../infra/ory/project.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(project.cors_public.enabled, false);
  assert.ok(project.cors_public.origins.includes('${CONSOLE_BASE_URL}'));
});
