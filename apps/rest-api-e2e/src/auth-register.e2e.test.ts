import { createHash, randomBytes } from 'node:crypto';

import {
  type Client,
  createClient,
  createTeam,
  createTeamInvite,
  deleteTeamInvite,
  enrollAgent,
  getWhoami,
  listTeamMembers,
  rotateClientSecret,
} from '@moltnet/api-client';
import { AGENT_OAUTH_SCOPES } from '@moltnet/auth';
import { cryptoService } from '@moltnet/crypto-service';
import { createAgentRepository } from '@moltnet/database';
import {
  buildSelfRegistrationMessage,
  buildTeamRegistrationMessage,
} from '@moltnet/models';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

async function signedSelfRegistration(
  credentialType: 'oauth2' | 'agent_key',
  existingKeyPair?: Awaited<ReturnType<typeof cryptoService.generateKeyPair>>,
) {
  const keyPair = existingKeyPair ?? (await cryptoService.generateKeyPair());
  const idempotencyKey = randomBytes(32).toString('base64url');
  const proof = await cryptoService.sign(
    buildSelfRegistrationMessage({
      idempotencyKey,
      publicKey: keyPair.publicKey,
      credentialType,
    }),
    keyPair.privateKey,
  );
  return { credentialType, idempotencyKey, keyPair, proof };
}

async function signedTeamRegistration(token: string) {
  const keyPair = await cryptoService.generateKeyPair();
  const idempotencyKey = randomBytes(32).toString('base64url');
  const enrollmentTokenHash = createHash('sha256').update(token).digest('hex');
  const proof = await cryptoService.sign(
    buildTeamRegistrationMessage({
      enrollmentTokenHash,
      idempotencyKey,
      publicKey: keyPair.publicKey,
      credentialType: 'oauth2',
    }),
    keyPair.privateKey,
  );
  return { idempotencyKey, keyPair, proof };
}

function requestOAuthToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
) {
  return fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: AGENT_OAUTH_SCOPES.join(' '),
    }),
  });
}

describe('proof-based registration', () => {
  let harness: TestHarness;
  let client: Client;
  let manager: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
    manager = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
  });
  afterAll(async () => harness?.teardown());

  it('self-registers and returns a usable OAuth2 credential', async () => {
    const input = await signedSelfRegistration('oauth2');
    const response = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify({
        publicKey: input.keyPair.publicKey,
        proof: input.proof,
        credentialType: input.credentialType,
      }),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      agentId: string;
      identityId: string;
      fingerprint: string;
      publicKey: string;
      credential: {
        type: 'oauth2';
        clientId: string;
        clientSecret: string;
      };
    };
    expect(result.fingerprint).toBe(input.keyPair.fingerprint);
    expect(result.publicKey).toBe(input.keyPair.publicKey);
    expect(result.credential.type).toBe('oauth2');

    const tokenResponse = await requestOAuthToken(
      harness.baseUrl,
      result.credential.clientId,
      result.credential.clientSecret,
    );
    expect(tokenResponse.status).toBe(200);
  });

  it('reissues a usable credential when the exact request is retried', async () => {
    const input = await signedSelfRegistration('oauth2');
    const request = () =>
      fetch(`${harness.baseUrl}/auth/register`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify({
          publicKey: input.keyPair.publicKey,
          proof: input.proof,
          credentialType: input.credentialType,
        }),
      });

    const first = await request();
    const second = await request();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstResult = (await first.json()) as {
      agentId: string;
      identityId: string;
      fingerprint: string;
      publicKey: string;
      credential: {
        type: 'oauth2';
        clientId: string;
        clientSecret: string;
      };
    };
    const secondResult = (await second.json()) as typeof firstResult;
    expect(secondResult).toMatchObject({
      // The durable id must be stable across a retry: a second agents row for
      // the same key would fork the principal, and the Kratos identity alone
      // cannot prove it did not happen.
      agentId: firstResult.agentId,
      identityId: firstResult.identityId,
      fingerprint: firstResult.fingerprint,
      publicKey: firstResult.publicKey,
      credential: {
        type: 'oauth2',
        clientId: firstResult.credential.clientId,
      },
    });
    expect(secondResult.credential.clientSecret).not.toBe(
      firstResult.credential.clientSecret,
    );
    await expect(
      requestOAuthToken(
        harness.baseUrl,
        firstResult.credential.clientId,
        firstResult.credential.clientSecret,
      ),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      requestOAuthToken(
        harness.baseUrl,
        secondResult.credential.clientId,
        secondResult.credential.clientSecret,
      ),
    ).resolves.toMatchObject({ status: 200 });
  });

  it('creates exactly one agent-key credential when selected', async () => {
    const input = await signedSelfRegistration('agent_key');
    const response = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify({
        publicKey: input.keyPair.publicKey,
        proof: input.proof,
        credentialType: input.credentialType,
      }),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      credential: { type: string; key: { id: string }; secret: string };
    };
    expect(result.credential.type).toBe('agent_key');
    expect(result.credential.key.id.length).toBeGreaterThan(0);
    expect(result.credential.secret.length).toBeGreaterThan(0);
  });

  it('rejects a proof after the nonce is modified', async () => {
    const input = await signedSelfRegistration('oauth2');
    const response = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomBytes(32).toString('base64url'),
      },
      body: JSON.stringify({
        publicKey: input.keyPair.publicKey,
        proof: input.proof,
        credentialType: input.credentialType,
      }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { code: string }).toEqual(
      expect.objectContaining({ code: 'INVALID_SIGNATURE' }),
    );
  });

  it('enrolls an agent whose OAuth2 credential can authenticate', async () => {
    const { data: team, error: teamError } = await createTeam({
      client,
      auth: () => manager.accessToken,
      body: { name: `enrollment-happy-${Date.now()}` },
    });
    expect(teamError).toBeUndefined();

    const { data: invite, error: inviteError } = await createTeamInvite({
      client,
      auth: () => manager.accessToken,
      path: { id: team!.id },
      body: { role: 'member', maxUses: 1, expiresInHours: 1 },
    });
    expect(inviteError).toBeUndefined();

    const input = await signedTeamRegistration(invite!.code);
    const enrolled = await enrollAgent({
      client,
      headers: { 'idempotency-key': input.idempotencyKey },
      body: {
        token: invite!.code,
        publicKey: input.keyPair.publicKey,
        proof: input.proof,
        credentialType: 'oauth2',
      },
    });
    expect(enrolled.response.status).toBe(200);
    expect(enrolled.error).toBeUndefined();
    expect(enrolled.data?.credential.type).toBe('oauth2');
    if (enrolled.data?.credential.type !== 'oauth2') {
      throw new Error('Enrollment did not return an OAuth2 credential');
    }

    const tokenResponse = await requestOAuthToken(
      harness.baseUrl,
      enrolled.data.credential.clientId,
      enrolled.data.credential.clientSecret,
    );
    expect(tokenResponse.status).toBe(200);
    const token = (await tokenResponse.json()) as { access_token: string };
    const whoami = await getWhoami({
      client,
      auth: () => token.access_token,
    });
    expect(whoami.response.status).toBe(200);
    expect(whoami.data?.identityId).toBe(enrolled.data.identityId);
  });

  it('redeems a single-use member invite into team membership', async () => {
    const { data: team, error: teamError } = await createTeam({
      client,
      auth: () => manager.accessToken,
      body: { name: `agent-invite-${Date.now()}` },
    });
    expect(teamError).toBeUndefined();

    const invite = await createTeamInvite({
      client,
      auth: () => manager.accessToken,
      path: { id: team!.id },
      body: { role: 'member', maxUses: 1, expiresInHours: 1 },
    });
    expect(invite.response.status).toBe(201);
    expect(invite.error).toBeUndefined();
    expect(invite.data?.code).toMatch(/^mlt_inv_[A-Za-z0-9_-]{22}$/);

    const input = await signedTeamRegistration(invite.data!.code);
    const enrolled = await enrollAgent({
      client,
      headers: { 'idempotency-key': input.idempotencyKey },
      body: {
        token: invite.data!.code,
        publicKey: input.keyPair.publicKey,
        proof: input.proof,
        credentialType: 'oauth2',
      },
    });
    expect(enrolled.response.status).toBe(200);
    expect(enrolled.error).toBeUndefined();

    const members = await listTeamMembers({
      client,
      auth: () => manager.accessToken,
      path: { id: team!.id },
    });
    expect(members.response.status).toBe(200);
    expect(
      members.data?.items.find(
        (member) => member.subjectId === enrolled.data?.identityId,
      )?.role,
    ).toBe('member');
  });

  it('honors an executor team invite during managed-agent enrollment', async () => {
    const { data: team, error: teamError } = await createTeam({
      client,
      auth: () => manager.accessToken,
      body: { name: `enrollment-executor-${Date.now()}` },
    });
    expect(teamError).toBeUndefined();

    const { data: invite, error: inviteError } = await createTeamInvite({
      client,
      auth: () => manager.accessToken,
      path: { id: team!.id },
      body: { role: 'executor', maxUses: 1, expiresInHours: 1 },
    });
    expect(inviteError).toBeUndefined();

    const input = await signedTeamRegistration(invite!.code);
    const enrolled = await enrollAgent({
      client,
      headers: { 'idempotency-key': input.idempotencyKey },
      body: {
        token: invite!.code,
        publicKey: input.keyPair.publicKey,
        proof: input.proof,
        credentialType: 'oauth2',
      },
    });
    expect(enrolled.response.status).toBe(200);

    const members = await listTeamMembers({
      client,
      auth: () => manager.accessToken,
      path: { id: team!.id },
    });
    expect(members.response.status).toBe(200);
    expect(
      members.data?.items.find(
        (member) => member.subjectId === enrolled.data?.agentId,
      )?.role,
    ).toBe('executor');
  });

  it('recovers after a failed enrollment: no orphan row, and the same keypair can register again', async () => {
    // Registration creates the agent row BEFORE the Kratos identity and before
    // claiming the invite, so a failure past that point has to compensate. The
    // property that matters operationally is that a failed attempt leaves
    // nothing behind that would block the agent from ever registering — the
    // 2026-09-04 incident made "can this principal come back" the question
    // this whole change exists to answer.
    const agentRepository = createAgentRepository(harness.db);

    const { data: team } = await createTeam({
      client,
      auth: () => manager.accessToken,
      body: { name: `enrollment-recovery-${Date.now()}` },
    });
    const { data: invite } = await createTeamInvite({
      client,
      auth: () => manager.accessToken,
      path: { id: team!.id },
      body: { role: 'member', maxUses: 1, expiresInHours: 1 },
    });

    // Two enrollments race for the single use. Whichever loses fails after its
    // agent row exists (claimInvite is inside the compensated boundary) or
    // before it (invite validation runs first) — the invariants below hold
    // either way, so the test does not depend on which side of that line the
    // scheduler lands.
    const first = await signedTeamRegistration(invite!.code);
    const second = await signedTeamRegistration(invite!.code);
    const enroll = (
      input: Awaited<ReturnType<typeof signedTeamRegistration>>,
    ) =>
      enrollAgent({
        client,
        headers: { 'idempotency-key': input.idempotencyKey },
        body: {
          token: invite!.code,
          publicKey: input.keyPair.publicKey,
          proof: input.proof,
          credentialType: 'oauth2',
        },
      });

    const [a, b] = await Promise.all([enroll(first), enroll(second)]);
    const attempts = [
      { input: first, result: a },
      { input: second, result: b },
    ];
    const winners = attempts.filter((x) => x.result.response.status === 200);
    const losers = attempts.filter((x) => x.result.response.status !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const loser = losers[0];

    // No orphan: the losing attempt must not leave a half-built agent behind,
    // whether it never created one or compensation removed it.
    expect(
      await agentRepository.findByFingerprint(loser.input.keyPair.fingerprint),
    ).toBeNull();

    // Recovery: the same keypair registers cleanly afterwards. A fresh
    // idempotency key is required and correct — the key identifies the
    // REQUEST, so reusing it would resolve to the failed workflow rather than
    // starting a new one.
    const retry = await signedSelfRegistration('oauth2', loser.input.keyPair);
    const response = await fetch(`${harness.baseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': retry.idempotencyKey,
      },
      body: JSON.stringify({
        publicKey: retry.keyPair.publicKey,
        proof: retry.proof,
        credentialType: 'oauth2',
      }),
    });
    expect(response.status).toBe(200);
    const registered = (await response.json()) as {
      agentId: string;
      credential: { clientId: string; clientSecret: string };
    };

    // Bound to a live identity, and the credential actually works — a row that
    // exists but cannot authenticate would be the subtler failure.
    const recovered = await agentRepository.findById(registered.agentId);
    expect(recovered?.fingerprint).toBe(loser.input.keyPair.fingerprint);
    expect(recovered?.identityId).toEqual(expect.any(String));

    const token = await requestOAuthToken(
      harness.baseUrl,
      registered.credential.clientId,
      registered.credential.clientSecret,
    );
    expect(token.status).toBe(200);
  });

  it('prevents registration after a team invite is revoked', async () => {
    const { data: team, error: teamError } = await createTeam({
      client,
      auth: () => manager.accessToken,
      body: { name: `enrollment-revoke-${Date.now()}` },
    });
    expect(teamError).toBeUndefined();

    const { data: invite, error: inviteError } = await createTeamInvite({
      client,
      auth: () => manager.accessToken,
      path: { id: team!.id },
      body: { role: 'member', maxUses: 1, expiresInHours: 1 },
    });
    expect(inviteError).toBeUndefined();

    const revoked = await deleteTeamInvite({
      client,
      auth: () => manager.accessToken,
      path: { id: team!.id, inviteId: invite!.id },
    });
    expect(revoked.response.status).toBe(200);
    expect(revoked.error).toBeUndefined();

    const input = await signedTeamRegistration(invite!.code);
    const redemption = await enrollAgent({
      client,
      headers: { 'idempotency-key': input.idempotencyKey },
      body: {
        token: invite!.code,
        publicKey: input.keyPair.publicKey,
        proof: input.proof,
        credentialType: 'oauth2',
      },
    });
    expect(redemption.response.status).toBe(403);
    expect(redemption.data).toBeUndefined();
  });

  it('invalidates the old OAuth2 secret when rotating credentials', async () => {
    const rotated = await rotateClientSecret({
      client,
      auth: () => manager.accessToken,
    });
    expect(rotated.response.status).toBe(200);
    expect(rotated.error).toBeUndefined();

    const oldSecretResponse = await requestOAuthToken(
      harness.baseUrl,
      manager.clientId,
      manager.clientSecret,
    );
    expect(oldSecretResponse.status).toBe(401);

    const newSecretResponse = await requestOAuthToken(
      harness.baseUrl,
      rotated.data!.clientId,
      rotated.data!.clientSecret,
    );
    expect(newSecretResponse.status).toBe(200);
  });
});
