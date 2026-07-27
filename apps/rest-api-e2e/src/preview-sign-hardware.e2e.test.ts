import {
  approveSigningCredential,
  beginSigningCredentialRegistration,
  claimSigningRequest,
  type Client,
  completeSigningCredentialRegistration,
  completeSigningRequest,
  createClient,
  createSigningRequest,
} from '@moltnet/api-client';
import { createRelationshipWriter, KetoNamespace } from '@moltnet/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAgent,
  createHuman,
  type TestAgent,
  type TestHuman,
} from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

const COMPANION_URL =
  process.env.MOLTNET_SIGNER_URL ?? 'http://127.0.0.1:17373';
const CONSOLE_ORIGIN =
  process.env.MOLTNET_SIGNER_ORIGIN ?? 'http://localhost:5174';
const VERIFICATION_METHOD = 'human-hardware-previewsign' as const;

interface CompanionSession {
  token: string;
}

interface CompanionCeremony {
  approvalUrl: string;
  id: string;
}

type CompanionResult =
  | { status: 'pending' }
  | {
      status: 'completed';
      operation: 'credential-enrollment';
      publicMaterial: Record<string, unknown>;
    }
  | {
      status: 'completed';
      operation: 'credential-registration' | 'signing-request';
      receipt: {
        verificationMethod: typeof VERIFICATION_METHOD;
        value: { version: 1; signature: string };
      };
    }
  | { status: 'failed'; code: string; message: string };

describe.skipIf(process.env.MOLTNET_PREVIEW_SIGN_HARDWARE !== '1')(
  'previewSign hardware beta gate',
  () => {
    let harness: TestHarness;
    let requester: TestAgent;
    let signer: TestHuman;
    let approver: TestHuman;
    let signerClient: Client;
    let approverClient: Client;
    let companionSession: CompanionSession;

    beforeAll(async () => {
      harness = await createTestHarness();
      requester = await createAgent({
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

      const relationships = createRelationshipWriter(
        harness.oryClients.relationship,
      );
      await relationships.grantTeamMembers(
        requester.personalTeamId,
        signer.identityId,
        KetoNamespace.Human,
      );
      await relationships.grantTeamManagers(
        requester.personalTeamId,
        approver.identityId,
        KetoNamespace.Human,
      );

      signerClient = humanClient(
        harness.baseUrl,
        signer.sessionToken,
        requester.personalTeamId,
      );
      approverClient = humanClient(
        harness.baseUrl,
        approver.sessionToken,
        requester.personalTeamId,
      );
      companionSession = await createCompanionSession();
    });

    afterAll(async () => {
      await harness?.teardown();
    });

    it(
      'enrolls, activates, claims, signs, and completes with one real device',
      async () => {
        const enrollment = await runCompanionCeremony(companionSession, {
          version: 1,
          operation: 'credential-enrollment',
          label: 'previewSign beta hardware gate',
          teamId: requester.personalTeamId,
        });
        expect(enrollment).toMatchObject({
          status: 'completed',
          operation: 'credential-enrollment',
        });
        if (
          enrollment.status !== 'completed' ||
          enrollment.operation !== 'credential-enrollment'
        ) {
          throw new Error('Hardware enrollment did not complete');
        }

        const registration = await beginSigningCredentialRegistration({
          client: signerClient,
          headers: { 'x-moltnet-team-id': requester.personalTeamId },
          body: {
            verificationMethod: VERIFICATION_METHOD,
            credentialType: 'preview-sign-arkg',
            algorithm: 'arkg-p256-esp256',
            label: 'previewSign beta hardware gate',
            publicMaterial: enrollment.publicMaterial as never,
          },
        });
        expect(registration.error).toBeUndefined();

        const registrationProof = await runCompanionCeremony(companionSession, {
          version: 1,
          operation: 'credential-registration',
          resourceId: registration.data!.id,
          challenge: registration.data!.challenge,
        });
        expect(registrationProof).toMatchObject({
          status: 'completed',
          operation: 'credential-registration',
        });
        if (
          registrationProof.status !== 'completed' ||
          registrationProof.operation !== 'credential-registration'
        ) {
          throw new Error('Hardware registration proof did not complete');
        }

        const credential = await completeSigningCredentialRegistration({
          client: signerClient,
          headers: { 'x-moltnet-team-id': requester.personalTeamId },
          path: { id: registration.data!.id },
          body: {
            publicMaterial: enrollment.publicMaterial as never,
            receipt: registrationProof.receipt,
          },
        });
        expect(credential.data?.status).toBe('pending_approval');

        const activated = await approveSigningCredential({
          client: approverClient,
          headers: { 'x-moltnet-team-id': requester.personalTeamId },
          path: { id: credential.data!.id },
        });
        expect(activated.data?.status).toBe('active');

        const request = await createSigningRequest({
          client: createClient({ baseUrl: harness.baseUrl }),
          auth: () => requester.accessToken,
          body: {
            message: 'previewSign beta hardware gate',
            verificationMethod: VERIFICATION_METHOD,
            teamId: requester.personalTeamId,
            purpose: 'Prove the packaged companion hardware path',
            signerConstraint: { type: 'human', id: signer.humanId },
          },
        });
        expect(request.error).toBeUndefined();

        const claim = await claimSigningRequest({
          client: signerClient,
          headers: { 'x-moltnet-team-id': requester.personalTeamId },
          path: { id: request.data!.id },
          body: { credentialId: activated.data!.id },
        });
        expect(claim.data?.status).toBe('claimed');

        const signature = await runCompanionCeremony(companionSession, {
          version: 1,
          operation: 'signing-request',
          resourceId: claim.data!.id,
          challenge: claim.data!.challenge,
        });
        expect(signature).toMatchObject({
          status: 'completed',
          operation: 'signing-request',
        });
        if (
          signature.status !== 'completed' ||
          signature.operation !== 'signing-request'
        ) {
          throw new Error('Hardware signing did not complete');
        }

        const completion = await completeSigningRequest({
          client: signerClient,
          headers: { 'x-moltnet-team-id': requester.personalTeamId },
          path: { id: claim.data!.id },
          body: { receipt: signature.receipt },
        });
        expect(completion.data).toMatchObject({
          id: request.data!.id,
          status: 'completed',
          valid: true,
          claimedByHumanId: signer.humanId,
          signingCredentialId: activated.data!.id,
        });

        process.stdout.write(
          `${JSON.stringify({
            event: 'previewSign.hardware_beta.complete',
            verificationMethod: VERIFICATION_METHOD,
            status: completion.data!.status,
            valid: completion.data!.valid,
          })}\n`,
        );
      },
      10 * 60 * 1000,
    );
  },
);

function humanClient(
  baseUrl: string,
  sessionToken: string,
  teamId: string,
): Client {
  const client = createClient({ baseUrl });
  client.interceptors.request.use((request) => {
    request.headers.set('X-Moltnet-Session-Token', sessionToken);
    request.headers.set('x-moltnet-team-id', teamId);
    return request;
  });
  return client;
}

async function createCompanionSession(): Promise<CompanionSession> {
  const response = await fetch(`${COMPANION_URL}/v1/sessions`, {
    method: 'POST',
    headers: { Origin: CONSOLE_ORIGIN },
  });
  if (!response.ok) {
    throw new Error(
      `Unable to create companion session: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as CompanionSession;
}

async function runCompanionCeremony(
  session: CompanionSession,
  body: Record<string, unknown>,
): Promise<CompanionResult> {
  const response = await fetch(`${COMPANION_URL}/v1/ceremonies`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: CONSOLE_ORIGIN,
      'x-moltnet-signer-session': session.token,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `Unable to create companion ceremony: ${response.status} ${await response.text()}`,
    );
  }
  const ceremony = (await response.json()) as CompanionCeremony;
  process.stdout.write(
    `\nMOLTNET_HARDWARE_APPROVAL_URL=${ceremony.approvalUrl}\n`,
  );

  for (let attempt = 0; attempt < 300; attempt += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1_000);
    });
    const resultResponse = await fetch(
      `${COMPANION_URL}/v1/ceremonies/${encodeURIComponent(ceremony.id)}/result`,
      {
        headers: {
          Origin: CONSOLE_ORIGIN,
          'x-moltnet-signer-session': session.token,
        },
      },
    );
    if (!resultResponse.ok) {
      throw new Error(
        `Unable to read companion result: ${resultResponse.status} ${await resultResponse.text()}`,
      );
    }
    const result = (await resultResponse.json()) as CompanionResult;
    if (result.status !== 'pending') return result;
  }
  throw new Error('Timed out waiting for hardware approval');
}
