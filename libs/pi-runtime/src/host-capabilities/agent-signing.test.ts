import { createHostCapabilityRouter } from '@themoltnet/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

import {
  agentSigningCapability,
  GUEST_ALLOWED_SIGNERS_PATH,
  GUEST_GITCONFIG_PATH,
  GUEST_SIGNER_SOCKET,
} from './agent-signing.js';

const ORIGIN = 'https://agent-signing.moltnet.internal';
const identity = {
  agentName: 'a',
  identityId: 'id',
  publicKey: 'ed25519:wBkbENwyQSOnY+OZIsVX1F3b35JvQ42juWDXyqTapN4=',
  fingerprint: 'F',
  gitName: 'A',
  gitEmail: 'a@x',
};

function build(withSigner = true) {
  const signer = {
    identity,
    signGitCommit: vi.fn(() =>
      Promise.resolve({ signature: new Uint8Array(64).fill(9) }),
    ),
    signDiaryEntry: vi.fn((input: { signingRequestId: string }) =>
      Promise.resolve(input),
    ),
  };
  const router = createHostCapabilityRouter({
    capabilities: [agentSigningCapability],
    logger: { info: vi.fn(), warn: vi.fn() },
    paths: { mountPath: '/work' },
    context: {
      taskId: 't',
      attemptN: 1,
      teamId: 'team',
      agent: {} as never,
      identity,
    },
    injected: withSigner ? { signer } : {},
  });
  router.setPolicy({ enforcement: 'off', allowedTools: new Set() });
  return { router, signer };
}

const post = (
  router: ReturnType<typeof build>['router'],
  operation: string,
  body: unknown,
) =>
  router.origins[ORIGIN](
    new Request(`${ORIGIN}/${operation}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );

describe('agentSigningCapability', () => {
  it('declares both operations and the guest projection', () => {
    const { router } = build();
    expect(router.manifest).toEqual([
      {
        name: 'agent-signing',
        origin: ORIGIN,
        operations: ['sign-diary-entry', 'sign-git-commit'],
        descriptorCid: agentSigningCapability.descriptorCid,
      },
    ]);
    expect(router.guestProjection.env).toEqual({
      MOLTNET_SIGNER_URL: ORIGIN,
      SSH_AUTH_SOCK: GUEST_SIGNER_SOCKET,
      GIT_CONFIG_GLOBAL: GUEST_GITCONFIG_PATH,
    });
    expect(router.guestProjection.files.map((file) => file.path)).toEqual([
      GUEST_GITCONFIG_PATH,
      GUEST_ALLOWED_SIGNERS_PATH,
    ]);
    const gitconfig = router.guestProjection.files[0].content;
    expect(gitconfig).toContain('signingKey = key::ssh-ed25519');
    expect(gitconfig).toContain('directory = /work');
    expect(gitconfig).not.toMatch(/id_ed25519|credential/);
    expect(router.guestProjection.files[1].content).toMatch(
      /^a@x namespaces="git" ssh-ed25519 /,
    );
    expect(router.guestProjection.services).toEqual([
      {
        id: 'signer-agent',
        readiness: { path: GUEST_SIGNER_SOCKET, timeoutMs: 8_000 },
        command: [
          'moltnet',
          'capability',
          'serve',
          'agent-signing',
          '--adapter',
          'ssh-agent',
          '--socket',
          GUEST_SIGNER_SOCKET,
        ],
      },
    ]);
  });

  it('sign-git-commit round-trips base64 and records only a digest', async () => {
    const { router, signer } = build();
    const envelope = Buffer.from('SSHSIG-envelope-bytes');
    const res = await post(router, 'sign-git-commit', {
      sshsig: envelope.toString('base64'),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      signature: Buffer.alloc(64, 9).toString('base64'),
    });
    expect(signer.signGitCommit).toHaveBeenCalledWith({
      sshsig: new Uint8Array(envelope),
    });
    const gitOperation = agentSigningCapability.operations[
      'sign-git-commit'
    ] as unknown as {
      evidence(input: { sshsig: string }): Record<string, string>;
    };
    expect(gitOperation.evidence({ sshsig: 'AAAA' })).toEqual({
      sshsigDigest: expect.stringMatching(
        /^sha256:[0-9a-f]{16}$/,
      ) as unknown as string,
    });
  });

  it('sign-diary-entry forwards a uuid request id and rejects other ids', async () => {
    const { router, signer } = build();
    const id = '2f1c0b9e-1111-4222-8333-444455556666';
    const res = await post(router, 'sign-diary-entry', {
      signingRequestId: id,
    });
    expect(await res.json()).toEqual({ signingRequestId: id });
    expect(signer.signDiaryEntry).toHaveBeenCalledWith({
      signingRequestId: id,
    });
    expect(
      (
        await post(router, 'sign-diary-entry', {
          signingRequestId: 'not-a-uuid',
        })
      ).status,
    ).toBe(400);
  });

  it('fails closed without an injected signer', async () => {
    const { router } = build(false);
    const res = await post(router, 'sign-git-commit', { sshsig: 'AA==' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      code: 'operation_failed',
      message: 'SignerUnavailable',
    });
  });
});
