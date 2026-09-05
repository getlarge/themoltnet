import { Type } from 'typebox';

import { AgentKeySchema } from './agent-keys.js';
import { DateTime } from './atoms.js';

// ── Agent ───────────────────────────────────────────────────

export const AgentProfileSchema = Type.Object(
  {
    publicKey: Type.String(),
    fingerprint: Type.String(),
  },
  { $id: 'AgentProfile' },
);

export const WhoamiSchema = Type.Object(
  {
    /**
     * Internal MoltNet principal ID — `agents.id` or `humans.id`.
     *
     * This is the only way an already-registered agent can discover its own
     * durable identifier: `agents.id` values are minted independently of Ory,
     * so nothing local can derive one. Everything an agent might key on
     * otherwise is mutable — the Kratos identity is re-linkable and the keypair
     * is rotatable.
     */
    principalId: Type.String({ format: 'uuid' }),
    /**
     * Kratos identity this request authenticated as.
     *
     * Required and non-nullable, unlike AgentPrincipal.identityId: this is the
     * caller's own identity, taken from the auth context rather than from
     * `agents.identity_id`. Token validation rejects any token without a
     * `moltnet:identity_id` claim, so an authenticated caller necessarily has
     * one — there is no reachable state where whoami would return null here.
     *
     * If agents are ever allowed to authenticate without a Kratos identity,
     * this becomes nullable and the token validator changes at the same time.
     */
    identityId: Type.String({ format: 'uuid' }),
    subjectType: Type.Union([Type.Literal('agent'), Type.Literal('human')]),
    scopes: Type.Optional(Type.Array(Type.String())),
    currentTeamId: Type.Optional(
      Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    ),
    publicKey: Type.Optional(Type.String()),
    fingerprint: Type.Optional(Type.String()),
    clientId: Type.Optional(Type.String()),
    credentialBinding: Type.Optional(
      Type.Union([
        Type.Object({
          bindingScope: Type.Literal('team'),
          keyId: Type.String(),
          boundTeamId: Type.String({ format: 'uuid' }),
        }),
        Type.Object({
          bindingScope: Type.Literal('identity'),
          keyId: Type.String(),
        }),
      ]),
    ),
  },
  { $id: 'Whoami' },
);

export const VerifyResultSchema = Type.Object(
  {
    valid: Type.Boolean(),
    signer: Type.Optional(
      Type.Object({
        fingerprint: Type.String(),
      }),
    ),
  },
  { $id: 'VerifyResult' },
);

// ── Registration ───────────────────────────────────────────

export const RegistrationCredentialTypeSchema = Type.Union(
  [Type.Literal('oauth2'), Type.Literal('agent_key')],
  { $id: 'RegistrationCredentialType' },
);

export const OAuth2RegistrationCredentialSchema = Type.Object(
  {
    type: Type.Literal('oauth2'),
    clientId: Type.String(),
    clientSecret: Type.String(),
  },
  { $id: 'OAuth2RegistrationCredential' },
);

export const AgentKeyRegistrationCredentialSchema = Type.Object(
  {
    type: Type.Literal('agent_key'),
    key: Type.Ref(AgentKeySchema.$id),
    secret: Type.String(),
  },
  { $id: 'AgentKeyRegistrationCredential' },
);

export const RegisterResponseSchema = Type.Object(
  {
    /**
     * Internal MoltNet agent ID — the durable identifier.
     *
     * This is the Keto subject, the target of every agent foreign key and the
     * OAuth2 client-ID derivation. Returned so an agent can persist something
     * stable: identityId below is re-linkable (a Kratos identity can be
     * recreated), so local decisions keyed on it cannot tell a relink from a
     * different agent reusing an alias.
     */
    agentId: Type.String({ format: 'uuid' }),
    identityId: Type.String({ format: 'uuid' }),
    fingerprint: Type.String(),
    publicKey: Type.String(),
    credential: Type.Union([
      Type.Ref(OAuth2RegistrationCredentialSchema.$id),
      Type.Ref(AgentKeyRegistrationCredentialSchema.$id),
    ]),
  },
  { $id: 'RegisterResponse' },
);

export const AgentEnrollmentSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    expiresAt: DateTime,
    redeemedAt: Type.Union([DateTime, Type.Null()]),
    revokedAt: Type.Union([DateTime, Type.Null()]),
    resultingAgentId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
    createdAt: DateTime,
  },
  { $id: 'AgentEnrollment' },
);

export const CreatedAgentEnrollmentSchema = Type.Intersect(
  [Type.Ref(AgentEnrollmentSchema.$id), Type.Object({ token: Type.String() })],
  { $id: 'CreatedAgentEnrollment' },
);

export const AgentEnrollmentParamsSchema = Type.Object(
  { id: Type.String({ format: 'uuid' }) },
  { $id: 'AgentEnrollmentParams' },
);

export const RotateSecretResponseSchema = Type.Object(
  {
    clientId: Type.String(),
    clientSecret: Type.String(),
  },
  { $id: 'RotateSecretResponse' },
);

// ── Params ──────────────────────────────────────────────────

export const EntryParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export const AgentParamsSchema = Type.Object({
  fingerprint: Type.String({
    pattern: '^[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}$',
  }),
});
