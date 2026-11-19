import type { Identity } from '@ory/client-fetch';
import { describe, expect, it } from 'vitest';

import {
  importIdentity,
  planBindings,
  type Principal,
} from '../src/ory-transfer.js';

const sourceId = '11111111-1111-4111-8111-111111111111';
const agentId = '22222222-2222-4222-8222-222222222222';
const staleId = '33333333-3333-4333-8333-333333333333';
const identity = (overrides: Partial<Identity> = {}): Identity => ({
  id: sourceId,
  schema_id: 'human',
  schema_url: 'https://example.invalid/schema',
  state: 'active',
  traits: { email: 'fixture@example.invalid' },
  ...overrides,
});

describe('credential transfer', () => {
  it('retains login hashes, provider subjects and verified addresses without provider tokens', () => {
    const body = importIdentity(
      identity({
        external_id: 'durable-fixture',
        metadata_admin: { purpose: 'fixture' },
        credentials: {
          password: {
            type: 'password',
            config: { hashed_password: 'fixture-hash' },
          },
          oidc: {
            type: 'oidc',
            config: {
              providers: [
                {
                  provider: 'github',
                  subject: 'fixture-subject',
                  initial_access_token: 'discard-me',
                },
              ],
            },
          },
        },
        verifiable_addresses: [
          {
            id: staleId,
            value: 'fixture@example.invalid',
            via: 'email',
            verified: true,
            status: 'completed',
          },
        ],
      }),
      false,
    );
    expect(body.external_id).toBe('durable-fixture');
    expect(body.metadata_admin).toEqual({ purpose: 'fixture' });
    expect(body.credentials?.password?.config?.hashed_password).toBe(
      'fixture-hash',
    );
    expect(body.credentials?.oidc?.config?.providers).toEqual([
      {
        provider: 'github',
        subject: 'fixture-subject',
        organization: undefined,
        use_auto_link: undefined,
      },
    ]);
    expect(body.verifiable_addresses?.[0]).toMatchObject({
      verified: true,
      status: 'completed',
      value: 'fixture@example.invalid',
    });
    expect(body.verifiable_addresses?.[0].id).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('discard-me');
  });

  it.each(['totp', 'passkey', 'webauthn', 'lookup_secret', 'saml'] as const)(
    'refuses to silently discard %s; explicit reenrolment keeps the account inactive',
    (type) => {
      const original = identity({
        credentials: { [type]: { type, config: { fixture: 'credential' } } },
      });
      expect(() => importIdentity(original, false)).toThrow();
      const body = importIdentity(original, true);
      expect(body.state).toBe('inactive');
      expect(JSON.stringify(body.credentials)).not.toContain('credential');
      expect(original.state).toBe('active');
    },
  );

  it('does not invent passwords for key-based agents or activate disabled identities', () => {
    const body = importIdentity(
      identity({
        state: 'inactive',
        credentials: { password: { type: 'password', config: {} } },
      }),
      false,
    );
    expect(body.state).toBe('inactive');
    expect(body.credentials?.password).toBeUndefined();
  });
});

describe('application identity bindings', () => {
  const agent: Principal = {
    kind: 'agent',
    id: agentId,
    identity_id: sourceId,
    public_key: 'fixture-public-key',
  };
  const sourceAgent = identity({ traits: { public_key: agent.public_key } });

  it('maps only live bindings and leaves durable identities, stale bindings and pending humans intact', () => {
    const principals = [
      agent,
      {
        kind: 'human' as const,
        id: staleId,
        identity_id: staleId,
        public_key: null,
      },
      {
        kind: 'human' as const,
        id: sourceId,
        identity_id: null,
        public_key: null,
      },
    ];
    const before = structuredClone(principals);
    const plan = planBindings(
      [
        sourceAgent,
        identity({ id: staleId.replace('3333-4333', '4444-4444') }),
      ],
      principals,
    );
    expect(plan).toEqual({
      bindings: [agent],
      unbound: 1,
      stale: 1,
      orphanIdentities: 1,
    });
    expect(principals).toEqual(before);
  });

  it('rejects a source key that differs from the durable agent key', () => {
    expect(() =>
      planBindings(
        [identity({ traits: { public_key: 'different-key' } })],
        [agent],
      ),
    ).toThrow();
  });

  it('rejects one source identity bound to two principals', () => {
    expect(() =>
      planBindings([sourceAgent], [agent, { ...agent, id: staleId }]),
    ).toThrow();
  });

  it('rejects binding a human to an agent identity and duplicate source IDs', () => {
    expect(() =>
      planBindings([sourceAgent], [{ ...agent, kind: 'human' }]),
    ).toThrow();
    expect(() => planBindings([sourceAgent, sourceAgent], [agent])).toThrow();
  });
});
