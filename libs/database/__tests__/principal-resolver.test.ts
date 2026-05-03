import { describe, expect, it } from 'vitest';

import {
  PrincipalAgentJoinFailedError,
  PrincipalMissingError,
  type PrincipalRow,
  PrincipalXorViolatedError,
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

  it('throws PrincipalXorViolatedError with both IDs in context', () => {
    const row: PrincipalRow = {
      creatorAgentId: '11111111-1111-1111-1111-111111111111',
      creatorAgentFingerprint: 'A1B2-C3D4-E5F6-1234',
      creatorAgentPublicKey: 'ed25519:x',
      creatorHumanId: '22222222-2222-2222-2222-222222222222',
      creatorHumanIdentityId: null,
    };
    let caught: unknown;
    try {
      resolvePrincipal(row);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PrincipalXorViolatedError);
    const err = caught as PrincipalXorViolatedError;
    expect(err.code).toBe('PRINCIPAL_XOR_VIOLATED');
    expect(err.context).toEqual({
      creatorAgentId: '11111111-1111-1111-1111-111111111111',
      creatorHumanId: '22222222-2222-2222-2222-222222222222',
    });
    expect(err.message).toContain('11111111-1111-1111-1111-111111111111');
    expect(err.message).toContain('22222222-2222-2222-2222-222222222222');
  });

  it('throws PrincipalMissingError when neither column is set', () => {
    const row: PrincipalRow = {
      creatorAgentId: null,
      creatorAgentFingerprint: null,
      creatorAgentPublicKey: null,
      creatorHumanId: null,
      creatorHumanIdentityId: null,
    };
    expect(() => resolvePrincipal(row)).toThrow(PrincipalMissingError);
  });

  it('throws PrincipalAgentJoinFailedError with missing-field details', () => {
    const row: PrincipalRow = {
      creatorAgentId: '11111111-1111-1111-1111-111111111111',
      creatorAgentFingerprint: null,
      creatorAgentPublicKey: null,
      creatorHumanId: null,
      creatorHumanIdentityId: null,
    };
    let caught: unknown;
    try {
      resolvePrincipal(row);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PrincipalAgentJoinFailedError);
    const err = caught as PrincipalAgentJoinFailedError;
    expect(err.code).toBe('PRINCIPAL_AGENT_JOIN_FAILED');
    expect(err.missing).toEqual({ fingerprint: true, publicKey: true });
    expect(err.context.creatorAgentId).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(err.message).toMatch(/fingerprint.*publicKey/);
  });

  it('PrincipalAgentJoinFailedError reports only the missing field', () => {
    const row: PrincipalRow = {
      creatorAgentId: '11111111-1111-1111-1111-111111111111',
      creatorAgentFingerprint: 'A1B2-C3D4-E5F6-1234',
      creatorAgentPublicKey: null,
      creatorHumanId: null,
      creatorHumanIdentityId: null,
    };
    let caught: unknown;
    try {
      resolvePrincipal(row);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PrincipalAgentJoinFailedError);
    expect((caught as PrincipalAgentJoinFailedError).missing).toEqual({
      fingerprint: false,
      publicKey: true,
    });
  });
});
