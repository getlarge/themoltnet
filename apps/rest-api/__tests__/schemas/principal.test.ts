/**
 * Schema parity / contract tests for the principal discriminated union.
 *
 * These tests defend two invariants that humans + tooling rely on but
 * neither the type system nor the runtime catches automatically:
 *
 *   1. The inline variant shapes inside `PrincipalIdentitySchema` MUST
 *      stay structurally identical to the named `AgentPrincipalSchema`
 *      and `HumanPrincipalSchema` schemas. The union has to inline
 *      because Ajv 8 cannot resolve cross-`$id` $refs from inside an
 *      anyOf (see the long comment in `src/schemas/principal.ts`). A
 *      drift between inline and named copies will silently break either
 *      runtime serialization or the OpenAPI surface.
 *
 *   2. Every variant has `additionalProperties: false`. Without that,
 *      fjs / Ajv silently accept and emit fields that aren't on the
 *      contract — exactly the regression that PR #997 fixed (variant-
 *      specific fields like `fingerprint` were getting STRIPPED on the
 *      response because the schema permitted "anything" past `kind`).
 */

import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  AgentPrincipalSchema,
  HumanPrincipalSchema,
  PrincipalIdentitySchema,
} from '../../src/schemas/principal.js';

// TypeBox 0.34+ rejects values whose declared `format` is not registered.
// The principal schemas use `uuid` — register a permissive matcher so
// `Value.Check` can validate fixtures without pulling the full Ajv stack.
if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (value: string): boolean =>
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value,
    ),
  );
}

const AGENT_FIXTURE = {
  kind: 'agent' as const,
  identityId: '550e8400-e29b-41d4-a716-446655440000',
  fingerprint: 'A1B2-C3D4-E5F6-A7B8',
  publicKey: 'ed25519:BASE64PUBLICKEYPLACEHOLDERAAAAAAAAAAAAAAAAAA=',
};

const HUMAN_FIXTURE = {
  kind: 'human' as const,
  humanId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  identityId: null,
};

describe('PrincipalIdentitySchema', () => {
  describe('inline / named parity', () => {
    it('agent variant shape matches AgentPrincipalSchema property-for-property', () => {
      const inlineAgent = (
        PrincipalIdentitySchema as unknown as {
          anyOf: Array<{ properties: Record<string, unknown> }>;
        }
      ).anyOf[0];
      expect(Object.keys(inlineAgent.properties).sort()).toEqual(
        Object.keys(AgentPrincipalSchema.properties).sort(),
      );
    });

    it('human variant shape matches HumanPrincipalSchema property-for-property', () => {
      const inlineHuman = (
        PrincipalIdentitySchema as unknown as {
          anyOf: Array<{ properties: Record<string, unknown> }>;
        }
      ).anyOf[1];
      expect(Object.keys(inlineHuman.properties).sort()).toEqual(
        Object.keys(HumanPrincipalSchema.properties).sort(),
      );
    });
  });

  describe('additionalProperties enforcement', () => {
    it('rejects an agent-variant payload with an extra property', () => {
      const valid = Value.Check(PrincipalIdentitySchema, AGENT_FIXTURE);
      expect(valid).toBe(true);

      const withExtra = { ...AGENT_FIXTURE, rogue: 'field' };
      expect(Value.Check(PrincipalIdentitySchema, withExtra)).toBe(false);
    });

    it('rejects a human-variant payload with an extra property', () => {
      const valid = Value.Check(PrincipalIdentitySchema, HUMAN_FIXTURE);
      expect(valid).toBe(true);

      const withExtra = { ...HUMAN_FIXTURE, rogue: 'field' };
      expect(Value.Check(PrincipalIdentitySchema, withExtra)).toBe(false);
    });

    it('rejects a human-variant payload with agent-only fields', () => {
      const mixed = {
        ...HUMAN_FIXTURE,
        fingerprint: 'A1B2-C3D4-E5F6-G7H8',
      };
      expect(Value.Check(PrincipalIdentitySchema, mixed)).toBe(false);
    });

    it('rejects an agent-variant payload that omits fingerprint', () => {
      const incomplete = {
        kind: 'agent' as const,
        identityId: AGENT_FIXTURE.identityId,
        publicKey: AGENT_FIXTURE.publicKey,
      };
      expect(Value.Check(PrincipalIdentitySchema, incomplete)).toBe(false);
    });

    it('AgentPrincipalSchema (named) carries additionalProperties: false', () => {
      expect(AgentPrincipalSchema.additionalProperties).toBe(false);
    });

    it('HumanPrincipalSchema (named) carries additionalProperties: false', () => {
      expect(HumanPrincipalSchema.additionalProperties).toBe(false);
    });
  });

  describe('discriminator metadata', () => {
    it('declares kind as the discriminator for ogen / openapi-ts', () => {
      expect(
        (PrincipalIdentitySchema as unknown as { discriminator: unknown })
          .discriminator,
      ).toEqual({ propertyName: 'kind' });
    });
  });
});
