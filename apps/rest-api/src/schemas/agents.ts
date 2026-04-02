import { Type } from '@sinclair/typebox';

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
    publicKey: Type.String(),
    fingerprint: Type.String(),
    clientId: Type.String(),
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

export const RegisterResponseSchema = Type.Object(
  {
    identityId: Type.String({ format: 'uuid' }),
    fingerprint: Type.String(),
    publicKey: Type.String(),
    clientId: Type.String(),
    clientSecret: Type.String(),
  },
  { $id: 'RegisterResponse' },
);

export const RotateSecretResponseSchema = Type.Object(
  {
    clientId: Type.String(),
    clientSecret: Type.String(),
  },
  { $id: 'RotateSecretResponse' },
);

// ── Vouch ───────────────────────────────────────────────────

export const VoucherSchema = Type.Object(
  {
    code: Type.String(),
    expiresAt: DateTime,
    issuedBy: Type.String(),
  },
  { $id: 'Voucher' },
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
