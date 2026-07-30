import { CredentialError } from '@themoltnet/credentials';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TASK_CREDENTIAL_JWKS_PATH } from '../src/config.js';
import {
  createMockServices,
  createTestApp,
  HUMAN_AUTH_CONTEXT,
  KEY_AUTH_CONTEXT,
  type MockServices,
  OWNER_ID,
  resetMockServices,
  TEST_CREDENTIAL_ISSUER,
  TEST_CREDENTIAL_JWKS,
} from './helpers.js';

const TASK_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const TEAM_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const LEASE_ID = 'cccccccc-0000-4000-8000-000000000003';
const PROFILE_ID = 'dddddddd-0000-4000-8000-000000000004';
const ATTEMPT_N = 2;
const CREDENTIALS_URL = `/tasks/${TASK_ID}/attempts/${ATTEMPT_N}/credentials`;
const HEARTBEAT_URL = `/tasks/${TASK_ID}/attempts/${ATTEMPT_N}/heartbeat`;
const AGENT_KEY = 'ory_ak_team-bound-agent-key';

const CLAIMS = {
  version: 1 as const,
  kind: 'task' as const,
  agentId: OWNER_ID,
  teamId: TEAM_ID,
  taskId: TASK_ID,
  attemptN: ATTEMPT_N,
  leaseId: LEASE_ID,
  runtimeKind: 'gondolin_pi',
  executorManifestFingerprint: 'bafkreiexecutor',
  runtimeProfileId: PROFILE_ID,
  runtimeProfileRevision: 3,
  policySnapshotHash: `sha256:${'a'.repeat(64)}`,
};

const ISSUED = {
  token: 'header.payload.signature',
  expiresAt: new Date('2026-07-30T10:05:00.000Z'),
  claims: CLAIMS,
};

/** Agent key whose bound team matches the addressed task's team. */
const CLAIMANT_AUTH = {
  ...KEY_AUTH_CONTEXT,
  currentTeamId: TEAM_ID,
  credentialBinding: { keyId: 'key-123', boundTeamId: TEAM_ID },
};

function authHeaders(overrides: Record<string, string> = {}) {
  return {
    authorization: `Bearer ${AGENT_KEY}`,
    'x-moltnet-team-id': TEAM_ID,
    ...overrides,
  };
}

describe('POST /tasks/:id/attempts/:n/credentials', () => {
  let mocks: MockServices;
  let app: FastifyInstance;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, CLAIMANT_AUTH);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
    // Satisfies team-header resolution and the route's team-ceiling preHandler.
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.taskService.get.mockResolvedValue({ id: TASK_ID, teamId: TEAM_ID });
    mocks.credentialBroker.issueTaskCredential.mockResolvedValue(ISSUED);
  });

  it('issues a credential with server-owned verification metadata', async () => {
    const response = await app.inject({
      method: 'POST',
      url: CREDENTIALS_URL,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    // A bearer credential in a body must never be cached.
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.json()).toEqual({
      token: ISSUED.token,
      tokenType: 'Bearer',
      expiresAt: '2026-07-30T10:05:00.000Z',
      issuer: TEST_CREDENTIAL_ISSUER,
      audience: [TEST_CREDENTIAL_ISSUER],
      jwksUri: `${TEST_CREDENTIAL_ISSUER}${TASK_CREDENTIAL_JWKS_PATH}`,
      claims: CLAIMS,
    });
  });

  it('derives every broker input from the caller and the route', async () => {
    await app.inject({
      method: 'POST',
      url: CREDENTIALS_URL,
      headers: authHeaders(),
    });

    expect(mocks.credentialBroker.issueTaskCredential).toHaveBeenCalledWith({
      agentId: OWNER_ID,
      teamId: TEAM_ID,
      taskId: TASK_ID,
      attemptN: ATTEMPT_N,
      agentCredential: AGENT_KEY,
    });
  });

  it.each([
    { name: 'scopes', body: { scopes: ['moltnet:connector'] } },
    { name: 'a TTL', body: { ttlSeconds: 86_400 } },
    { name: 'an audience', body: { aud: 'https://attacker.example' } },
    { name: 'claims', body: { claims: { ...CLAIMS, teamId: 'other' } } },
    { name: 'a signing algorithm', body: { algorithm: 'none' } },
    { name: 'an upstream URL', body: { jwksUri: 'https://attacker.example' } },
  ])('rejects a request that smuggles $name', async ({ body }) => {
    const response = await app.inject({
      method: 'POST',
      url: CREDENTIALS_URL,
      headers: authHeaders(),
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.credentialBroker.issueTaskCredential).not.toHaveBeenCalled();
  });

  it('accepts an explicitly empty body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: CREDENTIALS_URL,
      headers: authHeaders(),
      payload: {},
    });

    expect(response.statusCode).toBe(200);
  });

  it('requires a team context', async () => {
    const response = await app.inject({
      method: 'POST',
      url: CREDENTIALS_URL,
      headers: { authorization: `Bearer ${AGENT_KEY}` },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.credentialBroker.issueTaskCredential).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'an authority denial',
      error: new CredentialError('authority_denied', 'denied'),
      status: 403,
    },
    {
      name: 'an exhausted lease',
      error: new CredentialError('ttl_exhausted', 'no time left'),
      status: 409,
    },
    {
      name: 'an unavailable authority',
      error: new CredentialError('authority_unavailable', 'db down'),
      status: 503,
    },
    {
      name: 'an unavailable evidence sink',
      error: new CredentialError('evidence_unavailable', 'db down'),
      status: 503,
    },
    {
      name: 'a signing failure',
      error: new CredentialError('derivation_failed', 'signing broke'),
      status: 500,
    },
  ])('maps $name to $status without a token', async ({ error, status }) => {
    mocks.credentialBroker.issueTaskCredential.mockRejectedValue(error);

    const response = await app.inject({
      method: 'POST',
      url: CREDENTIALS_URL,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(status);
    expect(response.body).not.toContain(ISSUED.token);
  });
});

describe('POST /tasks/:id/attempts/:n/credentials — non-claimant principals', () => {
  let mocks: MockServices;

  beforeEach(() => {
    mocks = createMockServices();
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.taskService.get.mockResolvedValue({ id: TASK_ID, teamId: TEAM_ID });
  });

  it('refuses a human principal', async () => {
    const app = await createTestApp(mocks, {
      ...HUMAN_AUTH_CONTEXT,
      currentTeamId: TEAM_ID,
    });

    const response = await app.inject({
      method: 'POST',
      url: CREDENTIALS_URL,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.credentialBroker.issueTaskCredential).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('agent-key cut-over telemetry (#1776 phase 0)', () => {
  let mocks: MockServices;
  let app: FastifyInstance;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, CLAIMANT_AUTH);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.taskService.get.mockResolvedValue({ id: TASK_ID, teamId: TEAM_ID });
    mocks.taskService.heartbeat.mockResolvedValue({
      claimExpiresAt: new Date('2026-07-30T10:10:00.000Z').toISOString(),
      cancelled: false,
      cancelReason: null,
    });
    mocks.credentialBroker.issueTaskCredential.mockResolvedValue(ISSUED);
  });

  it('counts an agent key used on a profile-backed attempt route', async () => {
    mocks.taskRepository.findAttempt.mockResolvedValue({
      taskId: TASK_ID,
      attemptN: ATTEMPT_N,
      leaseId: LEASE_ID,
      runtimeProfileId: PROFILE_ID,
    });

    await app.inject({
      method: 'POST',
      url: HEARTBEAT_URL,
      headers: authHeaders(),
      payload: {},
    });

    expect(mocks.agentKeyFallbackCounter.add).toHaveBeenCalledWith(1, {
      route: '/tasks/:id/attempts/:n/heartbeat',
    });
  });

  it('ignores a legacy attempt with no authority tuple', async () => {
    mocks.taskRepository.findAttempt.mockResolvedValue({
      taskId: TASK_ID,
      attemptN: ATTEMPT_N,
      leaseId: null,
      runtimeProfileId: null,
    });

    await app.inject({
      method: 'POST',
      url: HEARTBEAT_URL,
      headers: authHeaders(),
      payload: {},
    });

    expect(mocks.agentKeyFallbackCounter.add).not.toHaveBeenCalled();
  });

  it('does not count the credential exchange itself', async () => {
    mocks.taskRepository.findAttempt.mockResolvedValue({
      taskId: TASK_ID,
      attemptN: ATTEMPT_N,
      leaseId: LEASE_ID,
      runtimeProfileId: PROFILE_ID,
    });

    await app.inject({
      method: 'POST',
      url: CREDENTIALS_URL,
      headers: authHeaders(),
    });

    expect(mocks.agentKeyFallbackCounter.add).not.toHaveBeenCalled();
  });

  it('never fails a request when the counter throws', async () => {
    mocks.taskRepository.findAttempt.mockResolvedValue({
      taskId: TASK_ID,
      attemptN: ATTEMPT_N,
      leaseId: LEASE_ID,
      runtimeProfileId: PROFILE_ID,
    });
    mocks.agentKeyFallbackCounter.add.mockImplementation(() => {
      throw new Error('metrics exporter down');
    });

    const response = await app.inject({
      method: 'POST',
      url: HEARTBEAT_URL,
      headers: authHeaders(),
      payload: {},
    });

    expect(response.statusCode).toBe(200);
  });
});

describe(`GET ${TASK_CREDENTIAL_JWKS_PATH}`, () => {
  let mocks: MockServices;
  let app: FastifyInstance;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, null);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the published keys unauthenticated and cacheable', async () => {
    const response = await app.inject({
      method: 'GET',
      url: TASK_CREDENTIAL_JWKS_PATH,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(TEST_CREDENTIAL_JWKS);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
  });

  it('never serves private key members', async () => {
    // Serialization is schema-driven, so a private member cannot escape even if
    // one reaches the decorator.
    app.taskCredentials.jwks = {
      keys: [{ ...TEST_CREDENTIAL_JWKS.keys[0], d: 'private-key-material' }],
    };

    const response = await app.inject({
      method: 'GET',
      url: TASK_CREDENTIAL_JWKS_PATH,
    });

    expect(response.body).not.toContain('private-key-material');
    expect(response.json()).toEqual(TEST_CREDENTIAL_JWKS);
  });
});
