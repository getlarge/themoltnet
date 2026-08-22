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
