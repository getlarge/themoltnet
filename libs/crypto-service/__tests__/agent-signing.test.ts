import { describe, expect, it } from 'vitest';

import {
  allowedSignersLine,
  nonSecretGitconfig,
  sshPublicKeyLiteral,
} from '../src/agent-signing.js';
import { cryptoService } from '../src/crypto.service.js';
import { toSSHPublicKey } from '../src/ssh.js';

const identity = {
  agentName: 'legreffier',
  identityId: 'a854b555-aeef-4f13-ab22-8d0b819d478e',
  publicKey: 'ed25519:wBkbENwyQSOnY+OZIsVX1F3b35JvQ42juWDXyqTapN4=',
  fingerprint: '1671-B080-99BF-4270',
  gitName: 'LeGreffier',
  gitEmail: '261968324+legreffier[bot]@users.noreply.github.com',
};

describe('agent signing projection helpers', () => {
  it('builds the git public-key literal from the MoltNet public key', () => {
    expect(sshPublicKeyLiteral(identity.publicKey)).toBe(
      `key::${toSSHPublicKey(identity.publicKey)}`,
    );
  });

  it('builds an allowed_signers line scoped to the git namespace', () => {
    expect(allowedSignersLine(identity)).toBe(
      `${identity.gitEmail} namespaces="git" ${toSSHPublicKey(identity.publicKey)}`,
    );
  });

  it('emits a gitconfig with no key paths, credential helpers, or secrets', () => {
    const cfg = nonSecretGitconfig(identity, {
      allowedSignersFile: '/home/agent/.config/moltnet/allowed_signers',
      mountPath: '/work',
    });
    expect(cfg).toContain(
      '[user]\n\tname = LeGreffier\n\temail = 261968324+legreffier[bot]@users.noreply.github.com',
    );
    expect(cfg).toContain('signingKey = key::ssh-ed25519 ');
    expect(cfg).toContain('[gpg]\n\tformat = ssh');
    expect(cfg).toContain(
      'allowedSignersFile = /home/agent/.config/moltnet/allowed_signers',
    );
    expect(cfg).not.toContain('gpgsign');
    expect(cfg).toContain(
      '[url "https://github.com/"]\n\tinsteadOf = git@github.com:',
    );
    expect(cfg).toContain('[safe]\n\tdirectory = /work');
    expect(cfg).not.toMatch(/credential|id_ed25519|PRIVATE/);
  });

  it('keeps the fingerprint consistent with the public key', () => {
    expect(cryptoService.getFingerprintFromPublicKey(identity.publicKey)).toBe(
      identity.fingerprint,
    );
  });
});
