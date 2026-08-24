import {
  type AgentIdentity,
  type AgentSigningCapability,
  assertGitSshsigEnvelope,
  parseSshsigEnvelope,
} from '@moltnet/crypto-service';
import * as ed from '@noble/ed25519';
import type { Agent } from '@themoltnet/sdk';

export class SigningRequestNotOwnedError extends Error {
  override name = 'SigningRequestNotOwnedError';
}

const MAX_SIGNING_INPUT_BYTES = 4096;

/**
 * Host-side signer over the daemon's already-resolved Ed25519 seed. The seed
 * lives only in this closure; the returned object carries no own property
 * holding it. Every operation is purpose-bound: git envelopes are validated
 * before signing, diary requests are fetched through the host Agent and
 * checked for ownership, method and state before a signature is produced.
 */
export function createLocalSeedSigner(input: {
  privateKeySeed: string;
  agent: Agent;
  identity: AgentIdentity;
}): AgentSigningCapability {
  const seed = new Uint8Array(Buffer.from(input.privateKeySeed, 'base64'));
  if (seed.length !== 32) {
    throw new Error('privateKeySeed must be a base64 32-byte Ed25519 seed');
  }
  const sign = (bytes: Uint8Array) => ed.signAsync(bytes, seed);
  const { agent, identity } = input;

  return {
    identity,
    async signGitCommit({ sshsig }) {
      assertGitSshsigEnvelope(parseSshsigEnvelope(sshsig));
      return { signature: await sign(sshsig) };
    },
    async signDiaryEntry({ signingRequestId }) {
      const request = await agent.crypto.signingRequests.get(signingRequestId);
      if (request.agentId !== identity.identityId) {
        throw new SigningRequestNotOwnedError(
          'signing request is not owned by this identity',
        );
      }
      if (request.verificationMethod !== 'agent-ed25519') {
        throw new Error('signing request must use agent-ed25519');
      }
      if (request.status !== 'pending') {
        throw new Error('signing request is not pending');
      }
      const bytes = new Uint8Array(Buffer.from(request.signingInput, 'base64'));
      if (
        Buffer.from(bytes).toString('base64') !==
        request.signingInput.replace(/\s+/g, '')
      ) {
        throw new Error('signingInput is not valid base64');
      }
      if (bytes.length === 0 || bytes.length > MAX_SIGNING_INPUT_BYTES) {
        throw new Error('signingInput size out of bounds');
      }
      const signature = Buffer.from(await sign(bytes)).toString('base64');
      await agent.crypto.signingRequests.submit(signingRequestId, {
        signature,
      });
      return { signingRequestId };
    },
  };
}
