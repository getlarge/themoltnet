import {
  buildSigningBytes,
  cryptoService,
  encodeSshString,
} from '@moltnet/crypto-service';
import * as ed from '@noble/ed25519';
import { describe, expect, it, vi } from 'vitest';

import {
  createLocalSeedSigner,
  SigningRequestNotOwnedError,
} from './local-seed-signer.js';

async function fixture() {
  const kp = await cryptoService.generateKeyPair();
  const identity = {
    agentName: 'a',
    identityId: 'me',
    publicKey: kp.publicKey,
    fingerprint: kp.fingerprint,
    gitName: 'A',
    gitEmail: 'a@x',
  };
  const nonce = '5a0e4c4e-4d5e-4c5e-8b5e-5e5e5e5e5e5e';
  const request = {
    id: 'req-1',
    agentId: 'me',
    verificationMethod: 'agent-ed25519',
    status: 'pending',
    message: 'bafk',
    nonce,
    signingInput: Buffer.from(buildSigningBytes('bafk', nonce)).toString(
      'base64',
    ),
  };
  const signingRequests = {
    get: vi.fn(() => Promise.resolve(request)),
    submit: vi.fn(() => Promise.resolve({ ...request, status: 'completed' })),
  };
  const agent = { crypto: { signingRequests } };
  return {
    kp,
    identity,
    request,
    signingRequests,
    signer: createLocalSeedSigner({
      privateKeySeed: kp.privateKey,
      agent: agent as never,
      identity,
    }),
  };
}

const sshsig = (namespace: string) =>
  Buffer.concat([
    Buffer.from('SSHSIG'),
    encodeSshString(Buffer.from(namespace)),
    encodeSshString(Buffer.alloc(0)),
    encodeSshString(Buffer.from('sha512')),
    encodeSshString(Buffer.alloc(64, 1)),
  ]);

describe('createLocalSeedSigner', () => {
  it('signs a git SSHSIG envelope with the identity key', async () => {
    const { kp, signer } = await fixture();
    const { signature } = await signer.signGitCommit({ sshsig: sshsig('git') });
    expect(signature.length).toBe(64);
    expect(
      await ed.verifyAsync(
        signature,
        sshsig('git'),
        cryptoService.parsePublicKey(kp.publicKey),
      ),
    ).toBe(true);
  });

  it('refuses non-git namespaces', async () => {
    const { signer } = await fixture();
    await expect(
      signer.signGitCommit({ sshsig: sshsig('file') }),
    ).rejects.toThrow(/namespace "file"/);
  });

  it('fetches, verifies, signs and submits a diary signing request', async () => {
    const { kp, signer, signingRequests, request } = await fixture();
    await expect(
      signer.signDiaryEntry({ signingRequestId: 'req-1' }),
    ).resolves.toEqual({ signingRequestId: 'req-1' });
    const [id, body] = signingRequests.submit.mock.calls[0] as unknown as [
      string,
      { signature: string },
    ];
    expect(id).toBe('req-1');
    expect(
      await ed.verifyAsync(
        Buffer.from(body.signature, 'base64'),
        Buffer.from(request.signingInput, 'base64'),
        cryptoService.parsePublicKey(kp.publicKey),
      ),
    ).toBe(true);
  });

  it('refuses a request owned by another identity, a non-pending request, or a non-ed25519 method', async () => {
    const { signer, signingRequests, request } = await fixture();
    signingRequests.get.mockResolvedValueOnce({ ...request, agentId: 'other' });
    await expect(
      signer.signDiaryEntry({ signingRequestId: 'req-1' }),
    ).rejects.toBeInstanceOf(SigningRequestNotOwnedError);
    signingRequests.get.mockResolvedValueOnce({
      ...request,
      status: 'completed',
    });
    await expect(
      signer.signDiaryEntry({ signingRequestId: 'req-1' }),
    ).rejects.toThrow(/pending/);
    signingRequests.get.mockResolvedValueOnce({
      ...request,
      verificationMethod: 'human-hardware-previewsign',
    });
    await expect(
      signer.signDiaryEntry({ signingRequestId: 'req-1' }),
    ).rejects.toThrow(/agent-ed25519/);
    expect(signingRequests.submit).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', 0],
    ['exactly at the bound', 4096],
    ['one byte over the bound', 4097],
  ])('bounds signingInput: %s', async (_label, size) => {
    const { signer, signingRequests, request } = await fixture();
    signingRequests.get.mockResolvedValueOnce({
      ...request,
      signingInput: Buffer.alloc(size, 7).toString('base64'),
    });
    const call = signer.signDiaryEntry({ signingRequestId: 'req-1' });
    if (size === 0 || size > 4096) {
      await expect(call).rejects.toThrow(/out of bounds/);
      expect(signingRequests.submit).not.toHaveBeenCalled();
    } else {
      await expect(call).resolves.toEqual({ signingRequestId: 'req-1' });
      expect(signingRequests.submit).toHaveBeenCalledOnce();
    }
  });

  it('rejects malformed base64 signingInput without submitting', async () => {
    const { signer, signingRequests, request } = await fixture();
    signingRequests.get.mockResolvedValueOnce({
      ...request,
      signingInput: '%%%not-base64%%%',
    });
    await expect(
      signer.signDiaryEntry({ signingRequestId: 'req-1' }),
    ).rejects.toThrow(/base64/);
    expect(signingRequests.submit).not.toHaveBeenCalled();
  });

  it('never exposes the seed on the capability object', async () => {
    const { signer, kp } = await fixture();
    expect(JSON.stringify(signer)).not.toContain(kp.privateKey);
  });
});
