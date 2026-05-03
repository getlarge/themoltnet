import { describe, expect, it } from 'vitest';

import {
  type PrincipalRow,
  resolvePrincipal,
} from '../src/principal-resolver.js';

describe('resolvePrincipal', () => {
  it('returns agent variant when agent columns are present', () => {
    const row: PrincipalRow = {
      creatorAgentId: '11111111-1111-1111-1111-111111111111',
      creatorAgentFingerprint: 'A1B2-C3D4-E5F6-1234',
      creatorAgentPublicKey: 'ed25519:x',
      creatorHumanId: null,
      creatorHumanIdentityId: null,
    };
    expect(resolvePrincipal(row)).toEqual({
      kind: 'agent',
      identityId: '11111111-1111-1111-1111-111111111111',
      fingerprint: 'A1B2-C3D4-E5F6-1234',
      publicKey: 'ed25519:x',
    });
  });

  it('returns human variant when human columns are present', () => {
    const row: PrincipalRow = {
      creatorAgentId: null,
      creatorAgentFingerprint: null,
      creatorAgentPublicKey: null,
      creatorHumanId: '22222222-2222-2222-2222-222222222222',
      creatorHumanIdentityId: '33333333-3333-3333-3333-333333333333',
    };
    expect(resolvePrincipal(row)).toEqual({
      kind: 'human',
      humanId: '22222222-2222-2222-2222-222222222222',
      identityId: '33333333-3333-3333-3333-333333333333',
    });
  });

  it('returns human variant with null identityId pre-onboarding', () => {
    const row: PrincipalRow = {
      creatorAgentId: null,
      creatorAgentFingerprint: null,
      creatorAgentPublicKey: null,
      creatorHumanId: '22222222-2222-2222-2222-222222222222',
      creatorHumanIdentityId: null,
    };
    expect(resolvePrincipal(row)).toEqual({
      kind: 'human',
      humanId: '22222222-2222-2222-2222-222222222222',
      identityId: null,
    });
  });

  it('throws when both agent and human columns are set (XOR violation)', () => {
    const row: PrincipalRow = {
      creatorAgentId: '11111111-1111-1111-1111-111111111111',
      creatorAgentFingerprint: 'A1B2-C3D4-E5F6-1234',
      creatorAgentPublicKey: 'ed25519:x',
      creatorHumanId: '22222222-2222-2222-2222-222222222222',
      creatorHumanIdentityId: null,
    };
    expect(() => resolvePrincipal(row)).toThrow(/XOR|both/i);
  });

  it('throws when neither agent nor human columns are set', () => {
    const row: PrincipalRow = {
      creatorAgentId: null,
      creatorAgentFingerprint: null,
      creatorAgentPublicKey: null,
      creatorHumanId: null,
      creatorHumanIdentityId: null,
    };
    expect(() => resolvePrincipal(row)).toThrow(/missing|neither/i);
  });

  it('throws when agent variant missing fingerprint (JOIN miss)', () => {
    const row: PrincipalRow = {
      creatorAgentId: '11111111-1111-1111-1111-111111111111',
      creatorAgentFingerprint: null,
      creatorAgentPublicKey: null,
      creatorHumanId: null,
      creatorHumanIdentityId: null,
    };
    expect(() => resolvePrincipal(row)).toThrow(/fingerprint|JOIN/i);
  });
});
