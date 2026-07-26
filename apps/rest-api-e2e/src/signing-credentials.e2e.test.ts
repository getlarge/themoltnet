import {
  approveSigningCredential,
  beginSigningCredentialRegistration,
  claimSigningRequest,
  type Client,
  completeSigningCredentialRegistration,
  completeSigningRequest,
  createClient,
  createSigningRequest,
  getSigningCredential,
  listSigningCredentials,
  listSigningRequests,
  rejectSigningRequest,
  revokeSigningCredential,
  suspendSigningCredential,
} from '@moltnet/api-client';
import {
  createRelationshipWriter,
  KetoNamespace,
  type RelationshipWriter,
} from '@moltnet/auth';
import { signingRequests } from '@moltnet/database';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAgent,
  createHuman,
  type TestAgent,
  type TestHuman,
} from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

const VERIFICATION_METHOD = 'human-hardware-previewsign' as const;

function challengeResponse(challenge: unknown): string {
  const response = (challenge as { value?: { response?: unknown } } | undefined)
    ?.value?.response;
  if (typeof response !== 'string') {
    throw new Error('test signing driver returned an invalid challenge');
  }
  return response;
}

describe('Signing credential and delegated request lifecycle', () => {
  let harness: TestHarness;
  let requester: TestAgent;
  let otherTeamOwner: TestAgent;
  let signer: TestHuman;
  let approver: TestHuman;
  let client: Client;
  let signerClient: Client;
  let approverClient: Client;
  let relationships: RelationshipWriter;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
    relationships = createRelationshipWriter(harness.oryClients.relationship);
    requester = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
    otherTeamOwner = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
    signer = await createHuman({
      kratosPublicFrontend: harness.kratosPublicFrontend,
    });
    approver = await createHuman({
      kratosPublicFrontend: harness.kratosPublicFrontend,
    });
    await relationships.grantTeamMembers(
      requester.personalTeamId,
      signer.identityId,
      KetoNamespace.Human,
    );
    await relationships.grantTeamMembers(
      otherTeamOwner.personalTeamId,
      signer.identityId,
      KetoNamespace.Human,
    );
    await relationships.grantTeamManagers(
      requester.personalTeamId,
      approver.identityId,
      KetoNamespace.Human,
    );

    signerClient = createClient({ baseUrl: harness.baseUrl });
    signerClient.interceptors.request.use((request) => {
      request.headers.set('X-Moltnet-Session-Token', signer.sessionToken);
      if (!request.headers.has('x-moltnet-team-id')) {
        request.headers.set('x-moltnet-team-id', requester.personalTeamId);
      }
      return request;
    });
    approverClient = createClient({ baseUrl: harness.baseUrl });
    approverClient.interceptors.request.use((request) => {
      request.headers.set('X-Moltnet-Session-Token', approver.sessionToken);
      if (!request.headers.has('x-moltnet-team-id')) {
        request.headers.set('x-moltnet-team-id', requester.personalTeamId);
      }
      return request;
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('enrolls, approves, claims, verifies, completes, and retires a credential', async () => {
    const begun = await beginSigningCredentialRegistration({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      body: {
        verificationMethod: VERIFICATION_METHOD,
        credentialType: 'test-only',
        algorithm: 'test-only',
        label: 'E2E delegated signer',
      },
    });
    expect(begun.error).toBeUndefined();

    const privateMaterial = await completeSigningCredentialRegistration({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: begun.data!.id },
      body: {
        publicMaterial: {
          version: 1,
          nested: { privateKey: 'must-never-persist' },
        },
        receipt: {
          verificationMethod: VERIFICATION_METHOD,
          value: { response: challengeResponse(begun.data!.challenge) },
        },
      },
    });
    expect(privateMaterial.response.status).toBe(400);

    const completedEnrollment = await completeSigningCredentialRegistration({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: begun.data!.id },
      body: {
        publicMaterial: { version: 1, publicKey: 'e2e-public-only' },
        receipt: {
          verificationMethod: VERIFICATION_METHOD,
          value: { response: challengeResponse(begun.data!.challenge) },
        },
      },
    });
    expect(completedEnrollment.error).toBeUndefined();
    expect(completedEnrollment.data!.status).toBe('pending_approval');

    const memberApproval = await approveSigningCredential({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: completedEnrollment.data!.id },
    });
    expect(memberApproval.response.status).toBe(403);

    const approved = await approveSigningCredential({
      client: approverClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: completedEnrollment.data!.id },
    });
    expect(approved.error).toBeUndefined();
    expect(approved.data!.status).toBe('active');

    const listed = await listSigningCredentials({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
    });
    expect(listed.error).toBeUndefined();
    expect(listed.data!.items.map(({ id }) => id)).toContain(approved.data!.id);

    const fetched = await getSigningCredential({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: approved.data!.id },
    });
    expect(fetched.data).toMatchObject({ id: approved.data!.id });

    const crossTeam = await getSigningCredential({
      client: signerClient,
      headers: { 'x-moltnet-team-id': otherTeamOwner.personalTeamId },
      path: { id: approved.data!.id },
    });
    expect(crossTeam.response.status).toBe(404);

    const created = await createSigningRequest({
      client,
      auth: () => requester.accessToken,
      body: {
        message: 'release artifact bafy-e2e',
        verificationMethod: VERIFICATION_METHOD,
        teamId: requester.personalTeamId,
        purpose: 'Approve the e2e release artifact',
        signerConstraint: { type: 'human', id: signer.humanId },
      },
    });
    expect(created.error).toBeUndefined();
    expect(created.data!.requestedBy).toEqual({
      id: requester.identityId,
      type: 'agent',
    });

    const signable = await listSigningRequests({
      client: signerClient,
      query: { scope: 'signable' },
    });
    expect(signable.error).toBeUndefined();
    expect(signable.data!.items.map(({ id }) => id)).toContain(
      created.data!.id,
    );

    const claims = await Promise.all([
      claimSigningRequest({
        client: signerClient,
        headers: { 'x-moltnet-team-id': requester.personalTeamId },
        path: { id: created.data!.id },
        body: { credentialId: approved.data!.id },
      }),
      claimSigningRequest({
        client: signerClient,
        headers: { 'x-moltnet-team-id': requester.personalTeamId },
        path: { id: created.data!.id },
        body: { credentialId: approved.data!.id },
      }),
    ]);
    expect(claims.map(({ response }) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const claimed = claims.find(({ data }) => data !== undefined)!.data!;
    const response = challengeResponse(claimed.challenge);

    const wrongMethod = await completeSigningRequest({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: created.data!.id },
      body: {
        receipt: {
          verificationMethod: 'agent-ed25519',
          value: { response },
        },
      },
    });
    expect(wrongMethod.response.status).toBe(400);

    const invalidReceipt = await completeSigningRequest({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: created.data!.id },
      body: {
        receipt: {
          verificationMethod: VERIFICATION_METHOD,
          value: { response: 'wrong' },
        },
      },
    });
    expect(invalidReceipt.response.status).toBe(400);

    const completed = await completeSigningRequest({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: created.data!.id },
      body: {
        receipt: {
          verificationMethod: VERIFICATION_METHOD,
          value: { response },
        },
      },
    });
    expect(completed.error).toBeUndefined();
    expect(completed.data).toMatchObject({
      status: 'completed',
      valid: true,
      claimedByHumanId: signer.humanId,
      signingCredentialId: approved.data!.id,
    });

    const replay = await completeSigningRequest({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: created.data!.id },
      body: {
        receipt: {
          verificationMethod: VERIFICATION_METHOD,
          value: { response },
        },
      },
    });
    expect(replay.response.status).toBe(409);

    const expiredBeforeClaim = await createSigningRequest({
      client,
      auth: () => requester.accessToken,
      body: {
        message: 'expired before claim',
        verificationMethod: VERIFICATION_METHOD,
        teamId: requester.personalTeamId,
        purpose: 'Exercise claim expiry',
        signerConstraint: { type: 'human', id: signer.humanId },
      },
    });
    await harness.db
      .update(signingRequests)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(signingRequests.id, expiredBeforeClaim.data!.id));
    const expiredClaim = await claimSigningRequest({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: expiredBeforeClaim.data!.id },
      body: { credentialId: approved.data!.id },
    });
    expect(expiredClaim.response.status).toBe(409);

    const expiresAfterClaim = await createSigningRequest({
      client,
      auth: () => requester.accessToken,
      body: {
        message: 'expires after claim',
        verificationMethod: VERIFICATION_METHOD,
        teamId: requester.personalTeamId,
        purpose: 'Exercise completion expiry',
        signerConstraint: { type: 'human', id: signer.humanId },
      },
    });
    const expiringClaim = await claimSigningRequest({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: expiresAfterClaim.data!.id },
      body: { credentialId: approved.data!.id },
    });
    await harness.db
      .update(signingRequests)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(signingRequests.id, expiresAfterClaim.data!.id));
    const expiredCompletion = await completeSigningRequest({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: expiresAfterClaim.data!.id },
      body: {
        receipt: {
          verificationMethod: VERIFICATION_METHOD,
          value: { response: challengeResponse(expiringClaim.data!.challenge) },
        },
      },
    });
    expect(expiredCompletion.response.status).toBe(409);

    const suspended = await suspendSigningCredential({
      client: approverClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: approved.data!.id },
    });
    expect(suspended.data!.status).toBe('suspended');

    const revoked = await revokeSigningCredential({
      client: approverClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: approved.data!.id },
    });
    expect(revoked.data!.status).toBe('revoked');

    const approveAfterRevoke = await approveSigningCredential({
      client: approverClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: approved.data!.id },
    });
    expect(approveAfterRevoke.response.status).toBe(409);

    const suspendAfterRevoke = await suspendSigningCredential({
      client: approverClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: approved.data!.id },
    });
    expect(suspendAfterRevoke.response.status).toBe(409);
  });

  it('rejects self-approval against the real credential lifecycle SQL', async () => {
    const begun = await beginSigningCredentialRegistration({
      client: approverClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      body: {
        verificationMethod: VERIFICATION_METHOD,
        credentialType: 'test-only',
        algorithm: 'test-only',
        label: 'Self approval must fail',
      },
    });
    const completed = await completeSigningCredentialRegistration({
      client: approverClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: begun.data!.id },
      body: {
        publicMaterial: { version: 1, publicKey: 'self-approval-public' },
        receipt: {
          verificationMethod: VERIFICATION_METHOD,
          value: { response: challengeResponse(begun.data!.challenge) },
        },
      },
    });

    const approval = await approveSigningCredential({
      client: approverClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: completed.data!.id },
    });

    expect(approval.response.status).toBe(409);
  });

  it('rejects unsupported constraints and allows an eligible signer to reject', async () => {
    const unsupported = await createSigningRequest({
      client,
      auth: () => requester.accessToken,
      body: {
        message: 'site constrained',
        verificationMethod: VERIFICATION_METHOD,
        teamId: requester.personalTeamId,
        purpose: 'Unsupported site constraint',
        signerConstraint: { type: 'site', id: 'vienna' } as never,
      },
    });
    expect(unsupported.response.status).toBe(400);

    const created = await createSigningRequest({
      client,
      auth: () => requester.accessToken,
      body: {
        message: 'reject this request',
        verificationMethod: VERIFICATION_METHOD,
        teamId: requester.personalTeamId,
        purpose: 'Exercise explicit rejection',
        signerConstraint: { type: 'human', id: signer.humanId },
      },
    });
    const rejected = await rejectSigningRequest({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: created.data!.id },
      body: { reason: 'Not approved' },
    });
    expect(rejected.data).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Not approved',
    });

    const duplicate = await rejectSigningRequest({
      client: signerClient,
      headers: { 'x-moltnet-team-id': requester.personalTeamId },
      path: { id: created.data!.id },
      body: { reason: 'Again' },
    });
    expect(duplicate.response.status).toBe(409);
  });
});
