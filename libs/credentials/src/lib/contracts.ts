import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

export const CREDENTIAL_CLAIM_NAMESPACE =
  'https://themolt.net/claims/credentials/v1' as const;
export const CREDENTIAL_CONTRACT_VERSION = 1 as const;

const Identifier = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$',
});
// Credential identifiers deliberately require an RFC 4122 version and variant.
// Keep this public package independent from the private @moltnet/models package.
const Uuid = Type.String({
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
});
const Timestamp = Type.String({ format: 'date-time' });

export const TaskCredentialClaims = Type.Object(
  {
    version: Type.Literal(CREDENTIAL_CONTRACT_VERSION),
    kind: Type.Literal('task'),
    agentId: Uuid,
    teamId: Uuid,
    taskId: Uuid,
    attemptN: Type.Integer({ minimum: 1 }),
    leaseId: Uuid,
    runtimeKind: Identifier,
    capabilityManifestVersion: Identifier,
    runtimeProfileId: Uuid,
    runtimeProfileRevision: Type.Integer({ minimum: 1 }),
    policySnapshotHash: Type.String({ pattern: '^sha256:[0-9a-f]{64}$' }),
  },
  { $id: 'MoltNetTaskCredentialClaimsV1', additionalProperties: false },
);
export type TaskCredentialClaims = Static<typeof TaskCredentialClaims>;

export const ConnectorTaskBinding = Type.Pick(TaskCredentialClaims, [
  'agentId',
  'teamId',
  'taskId',
  'attemptN',
  'leaseId',
]);
export type ConnectorTaskBinding = Static<typeof ConnectorTaskBinding>;

export const ConnectorCredentialClaims = Type.Object(
  {
    version: Type.Literal(CREDENTIAL_CONTRACT_VERSION),
    kind: Type.Literal('connector'),
    task: ConnectorTaskBinding,
    grantId: Uuid,
    grantRevision: Type.Integer({ minimum: 1 }),
    connectorId: Identifier,
    operation: Identifier,
    resourceId: Identifier,
    parentTaskJti: Identifier,
  },
  { $id: 'MoltNetConnectorCredentialClaimsV1', additionalProperties: false },
);
export type ConnectorCredentialClaims = Static<
  typeof ConnectorCredentialClaims
>;

export const CredentialClaims = Type.Union([
  TaskCredentialClaims,
  ConnectorCredentialClaims,
]);
export type CredentialClaims = Static<typeof CredentialClaims>;

export const CredentialEvidenceEvent = Type.Object(
  {
    version: Type.Literal(CREDENTIAL_CONTRACT_VERSION),
    event: Type.Union([
      Type.Literal('task_credential_issued'),
      Type.Literal('task_credential_denied'),
      Type.Literal('connector_credential_issued'),
      Type.Literal('connector_credential_denied'),
      Type.Literal('connector_invoked'),
      Type.Literal('connector_completed'),
      Type.Literal('connector_failed'),
    ]),
    occurredAt: Timestamp,
    outcome: Type.Union([Type.Literal('allow'), Type.Literal('deny')]),
    reason: Identifier,
    agentId: Type.Optional(Uuid),
    teamId: Type.Optional(Uuid),
    taskId: Type.Optional(Uuid),
    attemptN: Type.Optional(Type.Integer({ minimum: 1 })),
    connectorId: Type.Optional(Identifier),
    operation: Type.Optional(Identifier),
    resourceId: Type.Optional(Identifier),
    grantId: Type.Optional(Uuid),
    grantRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    credentialJti: Type.Optional(Identifier),
    credentialKid: Type.Optional(Identifier),
  },
  { $id: 'MoltNetCredentialEvidenceEventV1', additionalProperties: false },
);
export type CredentialEvidenceEvent = Static<typeof CredentialEvidenceEvent>;

export const CredentialAuthorizationError = Type.Object(
  {
    version: Type.Literal(CREDENTIAL_CONTRACT_VERSION),
    code: Type.Union([
      Type.Literal('credential_invalid'),
      Type.Literal('credential_expired'),
      Type.Literal('credential_signature_invalid'),
      Type.Literal('credential_verification_unavailable'),
      Type.Literal('credential_binding_mismatch'),
      Type.Literal('authority_denied'),
      Type.Literal('authority_unavailable'),
      Type.Literal('derivation_failed'),
      Type.Literal('derivation_rejected'),
      Type.Literal('derivation_unavailable'),
      Type.Literal('evidence_unavailable'),
      Type.Literal('ttl_exhausted'),
      Type.Literal('gateway_denied'),
    ]),
    message: Type.String({ minLength: 1, maxLength: 255 }),
  },
  { $id: 'MoltNetCredentialAuthorizationErrorV1', additionalProperties: false },
);
export type CredentialAuthorizationError = Static<
  typeof CredentialAuthorizationError
>;

export function isTaskCredentialClaims(
  value: unknown,
): value is TaskCredentialClaims {
  return Value.Check(TaskCredentialClaims, value);
}

export function isConnectorCredentialClaims(
  value: unknown,
): value is ConnectorCredentialClaims {
  return Value.Check(ConnectorCredentialClaims, value);
}
