import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  HumanIdentitySchema,
  PrincipalIdentitySchema,
} from '../src/schemas/principal.js';

// Register the `uuid` format so Value.Check accepts UUID strings.
// Fastify registers this at runtime via Ajv; standalone tests must do it manually.
// Loose form (any 8-4-4-4-12 hex) — version/variant strictness is not enforced.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (v) => UUID_RE.test(v));
}

describe('PrincipalIdentitySchema', () => {
  it('accepts an agent variant', () => {
    const value = {
      kind: 'agent',
      identityId: '11111111-1111-1111-1111-111111111111',
      fingerprint: 'A1B2-C3D4-E5F6-1234',
      publicKey: 'ed25519:base64payload',
    };
    expect(Value.Check(PrincipalIdentitySchema, value)).toBe(true);
  });

  it('accepts a human variant with identityId', () => {
    const value = {
      kind: 'human',
      humanId: '22222222-2222-2222-2222-222222222222',
      identityId: '33333333-3333-3333-3333-333333333333',
    };
    expect(Value.Check(PrincipalIdentitySchema, value)).toBe(true);
  });

  it('accepts a human variant without identityId (pre-onboarding)', () => {
    const value = {
      kind: 'human',
      humanId: '22222222-2222-2222-2222-222222222222',
      identityId: null,
    };
    expect(Value.Check(PrincipalIdentitySchema, value)).toBe(true);
  });

  it('rejects an agent missing fingerprint', () => {
    const value = {
      kind: 'agent',
      identityId: '11111111-1111-1111-1111-111111111111',
      publicKey: 'ed25519:x',
    };
    expect(Value.Check(PrincipalIdentitySchema, value)).toBe(false);
  });

  it('rejects an unknown discriminator', () => {
    const value = { kind: 'system', id: 'x' };
    expect(Value.Check(PrincipalIdentitySchema, value)).toBe(false);
  });

  it('exports HumanIdentitySchema independently', () => {
    expect(HumanIdentitySchema).toBeDefined();
  });
});
